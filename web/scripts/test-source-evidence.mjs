import assert from 'node:assert/strict';
import test from 'node:test';
import { captureScheduleEvidence } from '../src/lib/schedule-evidence.ts';

const payload={from:'2026-10-13',to:'2026-10-13',timeZone:'America/New_York',reservationCount:1,
  reservations:[{id:'spanning',operatingDate:'2026-10-10',eventId:'event-1',resourceId:'pool-1',startAt:'2026-10-10T20:00Z',endAt:'2026-10-15T01:00Z',needsReview:false}],
  evidence:{version:2,sourceReadCompletedAt:'2026-10-13T12:00:00Z',receiptId:'original',events:[{eventId:'buyout',fullBuyout:true,allocationIds:[]}]}};
test('mirror evidence retains original clocks, spanning rows and buyouts without allocations',()=>{
  const captured=captureScheduleEvidence(payload);
  assert.deepEqual(captured.evidence,payload.evidence);
  assert.equal(captured.reservations[0].id,'spanning');
  assert.equal(captured.reservations[0].operatingDate,'2026-10-10');
});
test('legacy and truncated responses never become complete source evidence',()=>{
  assert.equal(captureScheduleEvidence({...payload,evidence:undefined}),null);
  assert.equal(captureScheduleEvidence({...payload,reservationCount:2}),null);
  assert.equal(captureScheduleEvidence({...payload,reservations:[]}),null);
});
