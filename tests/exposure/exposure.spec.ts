import { describe, expect, it } from 'vitest'
import { EXPOSURE_EVENT } from '../../src/domain/protocol.js'
import { detectExposure, validateRequiredExposure } from '../../src/exposure/detectors.js'

describe('exposure detectors', () => {
  it('自定义 receipt 或工具调用能证明 exposed 并保留证据引用', () => {
    const receipt = detectExposure(
      {
        events: [
          { type: 'plugin/loaded', data: { name: 'target' } },
          { type: EXPOSURE_EVENT, data: { plugin: 'target' } },
        ],
      },
      [{ id: 'receipt', kind: 'custom_receipt', plugin: 'target' }],
    )

    expect(receipt.state).toBe('exposed')
    expect(receipt.detectors).toEqual([{ id: 'receipt', matched: true, evidenceRefs: ['session:event:3'] }])
  })

  it('已加载但未暴露不会被误写成无效果，required exposure 返回缺证据', () => {
    const receipt = detectExposure({ events: [{ type: 'plugin/loaded', data: { name: 'target' } }] }, [
      { id: 'tool', kind: 'tool_name', toolName: 'target_tool' },
    ])

    expect(receipt.state).toBe('loaded')
    expect(validateRequiredExposure(receipt, true)).toEqual({
      code: 'required_exposure_missing',
      message: 'Target plugin exposure was not verified',
    })
  })

  it('没有检测器与生命周期证据时明确返回 unknown', () => {
    expect(detectExposure({ events: [] }, [])).toEqual({ state: 'unknown', detectors: [] })
  })

  it('可选 prompt、service 与 OTel 证据使用各自 detector', () => {
    const receipt = detectExposure(
      {
        events: [],
        prompt: 'System instructions\nUse the memory section.',
        serviceOperations: ['memory.lookup'],
        otelAttributes: { 'plugin.name': 'memory' },
      },
      [
        { id: 'prompt', kind: 'prompt_section', text: 'memory section' },
        { id: 'service', kind: 'service_operation', operation: 'memory.lookup' },
        { id: 'otel', kind: 'otel_attribute', key: 'plugin.name', value: 'memory' },
      ],
    )

    expect(receipt.state).toBe('exposed')
    expect(receipt.detectors).toEqual([
      { id: 'prompt', matched: true, evidenceRefs: ['prompt:system'] },
      { id: 'service', matched: true, evidenceRefs: ['service:memory.lookup'] },
      { id: 'otel', matched: true, evidenceRefs: ['otel:plugin.name'] },
    ])
  })
})
