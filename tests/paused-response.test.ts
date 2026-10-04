import { expect, it, vi } from 'vitest';
import { pausedMarketResponse } from '../collector/paused-response';
it('returns a terminal paused response before any optional runtime work', () => {
  const res: any = { setHeader: vi.fn(), end: vi.fn(), writeHead: vi.fn() };
  res.writeHead.mockReturnValue(res);
  expect(pausedMarketResponse(false, res)).toBe(true);
  expect(res.writeHead).toHaveBeenCalledWith(503);
  expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ error: 'Market collection remains paused.', paused: true });
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  vi.clearAllMocks();
  expect(pausedMarketResponse(true, res)).toBe(false);
  expect(res.writeHead).not.toHaveBeenCalled();
});
