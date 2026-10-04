import { expect, it, vi } from 'vitest';
import { SessionReads } from '../src/companion/session-reads';

it('deduplicates navigation reads and invalidates only changed data without timers',async()=>{
  let now=0;const reads=new SessionReads(()=>now),portfolios=vi.fn(async()=>['p']),holdings=vi.fn(async()=>['h']);
  await Promise.all(Array.from({length:10},()=>reads.read('portfolios',portfolios)));
  await reads.read('holdings/p',holdings);reads.invalidate('holdings/');
  await reads.read('portfolios',portfolios);await reads.read('holdings/p',holdings);
  expect(portfolios).toHaveBeenCalledTimes(1);expect(holdings).toHaveBeenCalledTimes(2);
  now=60_000;await reads.read('portfolios',portfolios);expect(portfolios).toHaveBeenCalledTimes(2);
});
it('failed reads can retry and different authenticated workspaces share no private cache',async()=>{
  const a=new SessionReads(),b=new SessionReads(),load=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue('private');
  await expect(a.read('portfolios',load)).rejects.toThrow('offline');
  await expect(a.read('portfolios',load)).resolves.toBe('private');
  const other=vi.fn(async()=> 'other account');await expect(b.read('portfolios',other)).resolves.toBe('other account');
  expect(load).toHaveBeenCalledTimes(2);expect(other).toHaveBeenCalledOnce();
});
