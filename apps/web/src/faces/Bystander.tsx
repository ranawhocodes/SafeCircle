/**
 * The bystander page (FR-TRG-8).
 *
 * What a stranger sees after scanning the QR on a pendant. It must carry NO
 * personal data: no name, no address, no medical note. Just a prompt, a button,
 * and the option to share where they are.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { ErrorNote, Spinner } from '../components/common.tsx';

interface BystanderPage {
  prompt: string;
  action: string;
  canAlertFamily: boolean;
  askForLocation: boolean;
  emergencyNotice: string;
}

export function Bystander(): ReactNode {
  const { code = '' } = useParams();
  const [page, setPage] = useState<BystanderPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locationState, setLocationState] = useState<'idle' | 'asking' | 'got' | 'refused'>('idle');

  useEffect(() => {
    api
      .get<BystanderPage>(`/api/bystander/${code}`)
      .then(setPage)
      .catch(setError);
  }, [code]);

  const shareLocation = (): void => {
    if (!navigator.geolocation) {
      setLocationState('refused');
      return;
    }
    setLocationState('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLocationState('got');
      },
      () => setLocationState('refused'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const alert = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ message?: string; familyAlerted: boolean }>(
        `/api/bystander/${code}/alert`,
        {
          lat: coords?.lat,
          lng: coords?.lng,
          accuracy_m: coords?.accuracy,
          note: note || undefined,
        },
      );
      setSent(
        res.message ??
          'Thank you. We have alerted their family and nearby helpers.',
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (error && !page) return <main className="narrow"><ErrorNote error={error} /></main>;
  if (!page) return <main className="narrow"><Spinner /></main>;

  if (sent) {
    return (
      <main className="narrow">
        <div className="card center">
          <h1>Thank you</h1>
          <p>{sent}</p>
          <div className="notice danger" style={{ marginTop: '1rem' }}>
            {page.emergencyNotice}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="narrow">
      <div className="card">
        <h1>{page.prompt}</h1>
        <p>{page.action}</p>

        <div className="notice danger" role="alert">
          {page.emergencyNotice}
        </div>

        <div className="field" style={{ marginTop: '1rem' }}>
          <label htmlFor="note">Anything you can tell us? (optional)</label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For example: sitting on a bench outside the market, seems confused."
          />
        </div>

        <div className="stack">
          {locationState === 'got' ? (
            <div className="notice good">
              Thank you — we have where you are, to about {Math.round(coords!.accuracy)} m.
            </div>
          ) : (
            <button onClick={shareLocation} disabled={locationState === 'asking'}>
              {locationState === 'asking' ? 'Asking your phone…' : 'Share where I am'}
            </button>
          )}
          {locationState === 'refused' && (
            <p className="hint">
              That's all right. You can still alert their family — please describe where you are in the
              box above.
            </p>
          )}

          <ErrorNote error={error} />

          <button
            className="primary big block"
            onClick={() => void alert()}
            disabled={busy || !page.canAlertFamily}
          >
            Alert their family
          </button>
          {!page.canAlertFamily && (
            <p className="hint">This code is not active. Please call 112 if someone needs help.</p>
          )}
        </div>

        <p className="hint" style={{ marginTop: '1rem' }}>
          We do not show you who this person is. Their family will be told where you are so they can
          reach you.
        </p>
      </div>
    </main>
  );
}
