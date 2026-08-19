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
  pluginConfig?: unknown
  model?: { provider: string; name: string }
}

export async function prepareIsolatedProfile(
  layout: ArmLayout,
  artifact: FrozenArtifact,
  options: IsolatedProfileOptions = {},
): Promise<void> {
  await mkdir(layout.profile, { recursive: true })
  const manifest = {
    name: 'dsh-profile-plugin-experiment',
    private: true,
    dependencies: { [artifact.packageName]: dependencyPath(layout.profile, layout.artifact) },
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
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
        ...(options.model === undefined
          ? []
          : [{ id: 'agent-default-model', config: { provider: options.model.provider, model: options.model.name } }]),
        {
          insert: [
            {
              id: 'plugin-experiment-target',
              name: artifact.packageName,
              config: options.pluginConfig ?? {},
            },
          ],
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
