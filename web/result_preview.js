import {thumbnail} from './generation.js';
const OUTPUT_FOLDER = 'h3_continuum_ez';
const PAGE_SIZE = 12;

export function resultVideo(api, record) {
  if (record?.type !== 'output' || record.subfolder !== OUTPUT_FOLDER ||
      typeof record.filename !== 'string' || !/^EZ_[0-9a-f]{32}\.mp4$/.test(record.filename) ||
      ![1,2].includes(record.plan?.schema) || !Array.isArray(record.plan.shots)) return null;

  const query = new URLSearchParams({
    filename: record.filename, subfolder: record.subfolder, type: record.type,
  });
  const route = '/view?' + query;
  const thumbnails=(Array.isArray(record.thumbnails)?record.thumbnails:[]).map(x=>thumbnail(api,x)).filter(Boolean);
  return {plan: record.plan, route, url: api.apiURL(route),thumbnails};
}

export async function findPreviousVideo(api, workflowId, timelineId, signal) {
  const query = new URLSearchParams({
    workflow_id: workflowId, status: 'completed', limit: String(PAGE_SIZE),
  });
  let offset = 0;
  while (!signal.aborted) {
    query.set('offset', String(offset));
    const response = await api.fetchApi('/jobs?' + query, {signal});
    if (!response.ok) return null;
    const {jobs, pagination} = await response.json();
    if (!Array.isArray(jobs) || jobs.length === 0) return null;

    for (const job of jobs) {
      if (signal.aborted) return null;
      if (job.workflow_id !== workflowId || job.outputs_count === 0 || typeof job.id !== 'string') continue;
      const detailResponse = await api.fetchApi('/jobs/' + encodeURIComponent(job.id), {signal});
      if (!detailResponse.ok) continue;
      const detail = await detailResponse.json();
      if (detail.workflow_id !== workflowId || detail.status !== 'completed') continue;
      for (const output of Object.values(detail.outputs ?? {}).reverse()) {
        const records = output?.h3ez_video;
        if (!Array.isArray(records)) continue;
        for (const record of records) {
          if (record?.node_id == null || String(record.node_id) !== String(timelineId)) continue;
          const video = resultVideo(api, record);
          if (!video) continue;
          const file = await api.fetchApi(video.route, {method: 'HEAD', signal});
          if (file.ok) return video;
        }
      }
    }

    if (!pagination?.has_more) return null;
    offset += jobs.length;
  }
  return null;
}
