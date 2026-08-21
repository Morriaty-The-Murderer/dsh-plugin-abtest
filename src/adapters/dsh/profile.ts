import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { stringify } from 'yaml'
import type { FrozenArtifact } from '../../domain/types.js'
import type { ArmLayout } from '../../runtime/layout.js'

function dependencyPath(profilePath: string, artifactPath: string): string {
  const path = relative(profilePath, artifactPath).split(sep).join('/')
  return `file:${path.startsWith('.') ? path : `./${path}`}`
}

function modulePath(profilePath: string, packageName: string): string {
  return join(profilePath, 'node_modules', ...packageName.split('/'))
}

export interface IsolatedProfileOptions {
  targetPlugin: string
  pluginConfig?: unknown
  model?: { provider: string; name: string; parameters?: Readonly<Record<string, unknown>> }
}

function modelPatch(model: NonNullable<IsolatedProfileOptions['model']>): unknown[] {
  const parameters = model.parameters ?? {}
  const openAiCompatiblePatch =
    model.provider === 'openai-compatible'
      ? [
          {
            id: 'llm-pi-ai',
            config: {
              providers: {
                'openai-compatible': {
                  api: 'openai-completions',
                  apiKeyEnv: parameters.apiKeyEnv,
                  baseURL: parameters.host,
                  models: [
                    {
                      id: model.name,
                      ...(parameters.contextWindow === undefined ? {} : { contextWindow: parameters.contextWindow }),
                      ...(parameters.maxTokens === undefined ? {} : { maxTokens: parameters.maxTokens }),
                    },
                  ],
                },
              },
            },
          },
        ]
      : []
  return [
    ...openAiCompatiblePatch,
    ...(model.provider === 'deepseek-official' && Object.keys(parameters).length > 0
      ? [{ id: 'llm-deepseek', config: parameters }]
      : []),
    { id: 'agent-default-model', config: { provider: model.provider, model: model.name } },
  ]
}

export async function prepareIsolatedProfile(
  layout: ArmLayout,
  artifact: FrozenArtifact,
  options: IsolatedProfileOptions,
): Promise<void> {
  await mkdir(layout.profile, { recursive: true })
  const manifest = {
    name: 'dsh-profile-plugin-experiment',
    private: true,
    dependencies: { [artifact.packageName]: dependencyPath(layout.profile, layout.artifact) },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-headless',
          ...(artifact.usesDshBundle === true ? [artifact.packageName] : []),
        ],
      },
    },
  }
  await Promise.all([
    writeFile(join(layout.profile, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`),
    writeFile(join(layout.profile, 'cordis.yml'), '[]\n'),
    writeFile(
      join(layout.profile, 'cordis.patch.yml'),
      stringify([
        { id: 'session-persistence-jsonl', config: { root: layout.sessionRoot } },
        ...(options.model === undefined ? [] : modelPatch(options.model)),
        artifact.usesDshBundle === true
          ? { id: options.targetPlugin, config: options.pluginConfig ?? {} }
          : {
              insert: [{ id: options.targetPlugin, name: artifact.packageName, config: options.pluginConfig ?? {} }],
            },
      ]),
    ),
    writeFile(
      join(layout.profile, 'pnpm-workspace.yaml'),
      'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
    ),
  ])
  const targetModulePath = modulePath(layout.profile, artifact.packageName)
  await mkdir(dirname(targetModulePath), { recursive: true })
  await symlink(layout.artifact, targetModulePath, 'dir')
}
