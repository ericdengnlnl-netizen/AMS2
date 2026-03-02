import { describe, expect, it } from 'vitest';
import { parseNbsDatanodes } from '../../src/adapters/nbs.adapter.js';

describe('nbs adapter parser', () => {
  it('parses datanodes and preserves hasData', () => {
    const out = parseNbsDatanodes(
      [
        {
          data: { data: 98.6, hasdata: true },
          wds: [
            { wdcode: 'zb', valuecode: 'A01080101' },
            { wdcode: 'sj', valuecode: '202601' }
          ]
        },
        {
          data: { data: 0, hasdata: false },
          wds: [
            { wdcode: 'zb', valuecode: 'A01080101' },
            { wdcode: 'sj', valuecode: '202512' }
          ]
        }
      ],
      'A01080101'
    );

    expect(out).toHaveLength(2);
    expect(out[0].obsDate.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(out[0].hasData).toBe(true);
    expect(out[1].hasData).toBe(false);
  });
});
