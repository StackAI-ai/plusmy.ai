import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobSummary } from '../app/dashboard/job-summary';

test('an unavailable job summary does not display a healthy zero', () => {
  const html = renderToStaticMarkup(<JobSummary unavailable processing={0} queued={0} deadLetter={0} />);
  assert.match(html, /Unavailable/);
  assert.match(html, /Unable to load sync job status/);
  assert.doesNotMatch(html, /0 processing|0 queued|0 dead-lettered/);
});

test('an available job summary labels the bounded recent counts', () => {
  const html = renderToStaticMarkup(<JobSummary unavailable={false} processing={1} queued={2} deadLetter={3} />);
  assert.match(html, />3<\/p>/);
  assert.match(html, /1 processing/);
  assert.match(html, /2 queued/);
  assert.match(html, /3 dead-lettered/);
  assert.match(html, /up to 80 recent jobs/);
});
