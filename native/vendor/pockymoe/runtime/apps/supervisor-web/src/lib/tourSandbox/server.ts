// OVERLAY (native): the app has no guided tour, so the sample device never answers.
export async function handleTourRequest(_path: string, _init: RequestInit): Promise<Response> {
  return new Response(JSON.stringify({ code: 'not_found', message: 'No tour device' }), { status: 404, headers: { 'content-type': 'application/json' } });
}
export function connectTourSocket(_emit: (data: string) => void) {
  return { close() {}, send(_data: string) {}, ready() {} };
}
export function resetTourSandbox() {}
