import { EXPOSURE_EVENT } from '../domain/protocol.js'
import type { ExposureReceipt, ExposureState } from '../domain/types.js'
import type { ExposureDetectorConfig, ExposureEvidence } from './types.js'

function eventData(event: { data?: unknown }): Record<string, unknown> {
  return event.data !== null && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {}
}

function lifecycleState(evidence: ExposureEvidence): ExposureState {
  const types = new Set(evidence.events.map((event) => event.type))
  if (types.has(EXPOSURE_EVENT)) return 'exposed'
  if (types.has('plugin/activated')) return 'activated'
  if (types.has('plugin/loaded')) return 'loaded'
  if (types.has('plugin/installed')) return 'installed'
  return 'unknown'
}

function eventMatches(
  evidence: ExposureEvidence,
  predicate: (type: string, data: Record<string, unknown>) => boolean,
): string[] {
  return evidence.events.flatMap((event, index) =>
    predicate(event.type, eventData(event)) ? [`session:event:${index + 2}`] : [],
  )
}

function evaluateDetector(evidence: ExposureEvidence, detector: ExposureDetectorConfig): string[] {
  switch (detector.kind) {
    case 'tool_name':
      return eventMatches(
        evidence,
        (type, data) =>
          type === 'tool/call' && (data.name === detector.toolName || data.toolName === detector.toolName),
      )
    case 'session_event':
      return eventMatches(evidence, (type) => type === detector.eventType)
    case 'prompt_section':
      return evidence.prompt?.includes(detector.text) === true ? ['prompt:system'] : []
    case 'service_operation':
      return evidence.serviceOperations?.includes(detector.operation) === true ? [`service:${detector.operation}`] : []
    case 'otel_attribute': {
      if (!Object.hasOwn(evidence.otelAttributes ?? {}, detector.key)) return []
      if (!Object.hasOwn(detector, 'value')) return [`otel:${detector.key}`]
      return Object.is(evidence.otelAttributes?.[detector.key], detector.value) ? [`otel:${detector.key}`] : []
    }
    case 'custom_receipt':
      return eventMatches(
        evidence,
        (type, data) => type === EXPOSURE_EVENT && (detector.plugin === undefined || data.plugin === detector.plugin),
      )
    case 'workspace_file_change': {
      const paths = evidence.workspaceDiff?.[detector.change] ?? []
      const matched = paths.filter((path) =>
        detector.match === 'prefix' ? path.startsWith(detector.path) : path === detector.path,
      )
      return matched.map((path) => `workspace-diff:${detector.change}:${path}`)
    }
  }
}

export function detectExposure(
  evidence: ExposureEvidence,
  detectors: readonly ExposureDetectorConfig[],
): ExposureReceipt {
  const results = detectors.map((detector) => {
    const evidenceRefs = evaluateDetector(evidence, detector)
    return { id: detector.id, matched: evidenceRefs.length > 0, evidenceRefs }
  })
  return {
    state: results.some((result) => result.matched) ? 'exposed' : lifecycleState(evidence),
    detectors: results,
  }
}

export function validateRequiredExposure(
  receipt: ExposureReceipt,
  required: boolean,
): { code: 'required_exposure_missing'; message: string } | undefined {
  return required && receipt.state !== 'exposed'
    ? { code: 'required_exposure_missing', message: 'Target plugin exposure was not verified' }
    : undefined
}
