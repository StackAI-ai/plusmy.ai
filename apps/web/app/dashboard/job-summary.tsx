import React from 'react';

export function JobSummary({ unavailable, processing, queued, deadLetter }: {
  unavailable: boolean;
  processing: number;
  queued: number;
  deadLetter: number;
}) {
  return (
    <>
      <p className="text-4xl font-semibold text-foreground">{unavailable ? 'Unavailable' : processing + queued}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {unavailable ? 'Unable to load sync job status.' : `${processing} processing · ${queued} queued · ${deadLetter} dead-lettered (up to 80 recent jobs)`}
      </p>
    </>
  );
}
