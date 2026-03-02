import axios from 'axios';
import type { SeriesRegistryItem } from '../config/series.registry.js';
import { parseNbsTimeCode } from '../domain/transformers.js';
import type { RawObservation, SourceAdapterResult } from '../domain/types.js';

interface NbsDataNode {
  data: {
    data: number;
    hasdata: boolean;
  };
  wds: Array<{
    wdcode: string;
    valuecode: string;
  }>;
}

interface NbsResponse {
  returncode: number;
  returndata: {
    datanodes: NbsDataNode[];
  } | string;
}

export function parseNbsDatanodes(datanodes: NbsDataNode[], sourceCode: string): RawObservation[] {
  return datanodes
    .map((node) => {
      const timeCode = node.wds.find((wd) => wd.wdcode === 'sj')?.valuecode;
      if (!timeCode) return null;
      const date = parseNbsTimeCode(timeCode);
      if (!date) return null;
      const value = Number(node.data.data);
      if (!Number.isFinite(value)) return null;
      return {
        obsDate: date,
        rawValue: value,
        sourceCode,
        hasData: Boolean(node.data.hasdata)
      } satisfies RawObservation;
    })
    .filter((v): v is RawObservation => Boolean(v));
}

async function queryNbs(
  dbcode: string,
  valueCode: string,
  windowCode: string
): Promise<{ observations: RawObservation[]; hasDataCount: number }> {
  const dfwds = JSON.stringify([
    { wdcode: 'zb', valuecode: valueCode },
    { wdcode: 'sj', valuecode: windowCode }
  ]);

  const response = await axios.get<NbsResponse>('https://data.stats.gov.cn/easyquery.htm', {
    timeout: 20_000,
    params: {
      m: 'QueryData',
      dbcode,
      rowcode: 'sj',
      colcode: 'zb',
      wds: '[]',
      dfwds,
      k1: Date.now()
    }
  });

  if (response.data.returncode !== 200 || typeof response.data.returndata === 'string') {
    return { observations: [], hasDataCount: 0 };
  }

  const parsed = parseNbsDatanodes(response.data.returndata.datanodes || [], valueCode);
  const withData = parsed.filter((item) => item.hasData);
  return {
    observations: parsed,
    hasDataCount: withData.length
  };
}

export class NbsAdapter {
  async fetchSeries(def: SeriesRegistryItem): Promise<SourceAdapterResult> {
    if (def.fetchConfig.type !== 'NBS') {
      throw new Error(`Series ${def.seriesKey} is not an NBS series`);
    }

    const { dbcode, valueCodeChain, windowCode } = def.fetchConfig;
    for (const valueCode of valueCodeChain) {
      const result = await queryNbs(dbcode, valueCode, windowCode);
      if (result.hasDataCount > 0) {
        return {
          observations: result.observations,
          sourceCode: valueCode
        };
      }
    }

    return {
      observations: [],
      sourceCode: valueCodeChain[0]
    };
  }
}
