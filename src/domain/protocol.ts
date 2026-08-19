export const PROTOCOL_IDENTIFIERS = {
  protocolNamespace: 'dsh.plugin-experiment',
  manifestSchema: 'urn:dsh:plugin-experiment:manifest:v1',
  defaultDataRoot: '$DSH_HOME/experiments',
  cordisEntryId: 'plugin-experiment-controller',
  telemetryNamespace: 'dsh.plugin_experiment',
  exposureEvent: 'dsh.plugin-experiment/exposure',
} as const

export const EXPOSURE_EVENT = PROTOCOL_IDENTIFIERS.exposureEvent
