import { Command, CommanderError } from 'commander'
import type { PromotionDecision } from '../domain/types.js'
import { PROJECT_IDENTITY } from '../identity/generated.js'
import { EXIT_CODES, exitCodeForDecision } from './exit-codes.js'
import { type CliIo, emit } from './output.js'
import {
  compareExperiment,
  decideExperiment,
  ExecutionFailure,
  freezeExperiment,
  initProject,
  reportExperiment,
  runExperiment,
  statusExperiment,
  ValidationFailure,
  validateExperiment,
} from './workflow.js'

interface CommonOptions {
  manifest: string
  output: string
  json: boolean
}

function addCommon(command: Command): Command {
  return command
    .requiredOption('--manifest <path>', 'experiment manifest path')
    .option('--output <path>', 'experiment evidence root', '.plugin-experiments')
    .option('--json', 'emit machine-readable JSON', false)
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let operation: Promise<number> | undefined
  const program = new Command()
    .name(PROJECT_IDENTITY.cliBin)
    .description('Run isolated paired experiments for DSH plugins')
    .exitOverride()
    .configureOutput({
      writeOut: (value) => io.stdout(value),
      writeErr: (value) => {
        if (!argv.includes('--json')) io.stderr(value)
      },
    })

  program
    .command('init')
    .requiredOption('--output <path>', 'new experiment project directory')
    .option('--json', 'emit machine-readable JSON', false)
    .action((options: { output: string; json: boolean }) => {
      operation = initProject(options.output).then((result) => {
        emit(io, { ok: true, ...result }, options.json)
        return EXIT_CODES.success
      })
    })

  addCommon(program.command('validate')).action((options: CommonOptions) => {
    operation = validateExperiment(options.manifest).then(({ manifest, cases }) => {
      emit(io, { ok: true, experimentId: manifest.experiment.id, caseCount: cases.length }, options.json)
      return EXIT_CODES.success
    })
  })
  addCommon(program.command('freeze')).action((options: CommonOptions) => {
    operation = freezeExperiment(options.manifest, options.output).then((result) => {
      emit(io, { ok: true, root: result.root, artifacts: result.artifacts }, options.json)
      return EXIT_CODES.success
    })
  })
  addCommon(program.command('run')).action((options: CommonOptions) => {
    operation = runExperiment(options.manifest, options.output).then((result) => {
      emit(io, { ok: true, pairCount: result.pairs.length, comparison: result.comparison }, options.json)
      return EXIT_CODES.success
    })
  })
  addCommon(program.command('status')).action((options: CommonOptions) => {
    operation = statusExperiment(options.manifest, options.output).then((status) => {
      emit(io, { ok: true, ...status }, options.json)
      return EXIT_CODES.success
    })
  })
  addCommon(program.command('compare')).action((options: CommonOptions) => {
    operation = compareExperiment(options.manifest, options.output).then((comparison) => {
      emit(io, { ok: true, comparison }, options.json)
      return EXIT_CODES.success
    })
  })
  addCommon(program.command('decision')).action((options: CommonOptions) => {
    operation = decideExperiment(options.manifest, options.output).then((decision: PromotionDecision) => {
      emit(io, { ok: true, ...decision }, options.json)
      return exitCodeForDecision(decision.outcome)
    })
  })
  addCommon(program.command('report')).action((options: CommonOptions) => {
    operation = reportExperiment(options.manifest, options.output).then((paths) => {
      emit(io, { ok: true, paths }, options.json)
      return EXIT_CODES.success
    })
  })

  try {
    await program.parseAsync([...argv], { from: 'user' })
    return operation === undefined ? EXIT_CODES.success : await operation
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return EXIT_CODES.success
    const json = argv.includes('--json')
    if (error instanceof ValidationFailure || error instanceof CommanderError) {
      emit(io, { ok: false, code: 'validation_error', message: error.message }, json, true)
      return EXIT_CODES.validationError
    }
    if (error instanceof ExecutionFailure) {
      emit(io, { ok: false, code: 'execution_failure', message: error.message }, json, true)
      return EXIT_CODES.executionFailure
    }
    emit(io, { ok: false, code: 'internal_error', message: (error as Error).message }, json, true)
    return EXIT_CODES.internalError
  }
}
