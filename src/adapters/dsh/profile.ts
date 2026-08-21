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

interface ProfileMode {
  path: string
  includeHeadless: boolean
  includeModel: boolean
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

async function prepareProfile(
  layout: ArmLayout,
  artifact: FrozenArtifact,
  options: IsolatedProfileOptions,
  mode: ProfileMode,
): Promise<void> {
  await mkdir(mode.path, { recursive: true })
  const manifest = {
    name: mode.includeHeadless ? 'dsh-profile-plugin-experiment' : 'dsh-profile-plugin-startup-audit',
    private: true,
    dependencies: { [artifact.packageName]: dependencyPath(mode.path, layout.artifact) },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          ...(mode.includeHeadless ? ['@deepseek-ai/dsh-headless'] : []),
          ...(artifact.usesDshBundle === true ? [artifact.packageName] : []),
        ],
      },
    },
  }
  await Promise.all([
    writeFile(join(mode.path, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`),
    writeFile(join(mode.path, 'cordis.yml'), '[]\n'),
    writeFile(
      join(mode.path, 'cordis.patch.yml'),
      stringify([
        { id: 'session-persistence-jsonl', config: { root: layout.sessionRoot } },
        ...(mode.includeModel && options.model !== undefined ? modelPatch(options.model) : []),
        artifact.usesDshBundle === true
          ? { id: options.targetPlugin, config: options.pluginConfig ?? {} }
          : {
              insert: [{ id: options.targetPlugin, name: artifact.packageName, config: options.pluginConfig ?? {} }],
            },
      ]),
    ),
    writeFile(
      join(mode.path, 'pnpm-workspace.yaml'),
      'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
    ),
  ])
  const targetModulePath = modulePath(mode.path, artifact.packageName)
  await mkdir(dirname(targetModulePath), { recursive: true })
  await symlink(layout.artifact, targetModulePath, 'dir')
}

export async function prepareIsolatedProfile(
  layout: ArmLayout,
  artifact: FrozenArtifact,
  options: IsolatedProfileOptions,
): Promise<void> {
  await prepareProfile(layout, artifact, options, {
    path: layout.profile,
    includeHeadless: true,
    includeModel: true,
  })
}

export async function prepareIsolatedStartupProfile(
  layout: ArmLayout,
  artifact: FrozenArtifact,
  options: IsolatedProfileOptions,
): Promise<void> {
  await prepareProfile(layout, artifact, options, {
    path: layout.startupProfile,
    includeHeadless: false,
    includeModel: false,
  })
}
