/**
 * 传输进度工具(Phase S5)— XHR 上传进度 + 流式下载进度。
 *
 * fetch 没有上传进度事件,改用 XMLHttpRequest;下载用 ReadableStream 逐块计数。
 * 用于大资源(高分辨率头像 / 未来 V3 大素材)在移动弱网下显示进度。
 */

/** XHR 上传(支持 upload progress 事件)。返回 Response 以便调用方判 status。 */
export function xhrUpload(
  url: string,
  opts: { method: string; headers?: Record<string, string>; body: XMLHttpRequestBodyInit },
  onProgress?: (loaded: number, total: number) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method, url);
    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) xhr.setRequestHeader(k, v);
    }
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.onerror = () => reject(new Error('网络错误(上传)'));
    xhr.ontimeout = () => reject(new Error('上传超时'));
    xhr.onload = () => {
      resolve(new Response(xhr.response, { status: xhr.status, statusText: xhr.statusText }));
    };
    xhr.send(opts.body);
  });
}

/**
 * 流式下载(支持下载进度,逐块计数)。
 * 无 onProgress 时等价 resp.blob();有则边读边上报,避免一次性 buffer 无反馈。
 */
export async function streamDownload(
  url: string,
  headers?: Record<string, string>,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Blob> {
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`下载失败 ${resp.status}`);
  if (!onProgress || !resp.body) return resp.blob();
  const total = Number(resp.headers.get('Content-Length')) || 0;
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
  }
  return new Blob(chunks);
}
