'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface ActionBarProps {
  reviewId: string;
  findingId: string;
  findingSummary: string;
  severity: string;
  drug?: string;
  toolName?: string;
  clinicianId?: string;
}

export function ActionBar({ reviewId, findingId, findingSummary, severity, drug, toolName, clinicianId = 'demo_clinician' }: ActionBarProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [action, setAction] = useState<string | null>(null);

  async function handleAction(act: 'accept' | 'override' | 'modify', reason?: string) {
    setStatus('loading');
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId, findingId, action: act, reason, clinicianId, severity, drug, toolName }),
    });
    setAction(act);
    setStatus('done');
  }

  if (status === 'done') {
    return (
      <div className="flex items-center gap-2 text-xs mt-2">
        <span className="text-green-400">Recorded: {action}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-3">
      <span className="text-xs text-gray-500">Action:</span>
      <Button size="sm" variant="outline" className="text-green-400 border-green-800 hover:bg-green-950 text-xs h-7"
        onClick={() => handleAction('accept')} disabled={status === 'loading'}>
        Accept
      </Button>
      <Button size="sm" variant="outline" className="text-red-400 border-red-800 hover:bg-red-950 text-xs h-7"
        onClick={() => handleAction('override', 'Clinician override')} disabled={status === 'loading'}>
        Override
      </Button>
      <Button size="sm" variant="outline" className="text-yellow-400 border-yellow-800 hover:bg-yellow-950 text-xs h-7"
        onClick={() => handleAction('modify', 'Modified recommendation')} disabled={status === 'loading'}>
        Modify
      </Button>
    </div>
  );
}
