import { useEffect, useState } from 'react';

let push: (msg: string, bad?: boolean) => void = () => {};

export function toast(msg: string, bad = false) {
  push(msg, bad);
}

export function ToastHost() {
  const [state, setState] = useState<{ msg: string; bad: boolean } | null>(null);
  useEffect(() => {
    push = (msg, bad = false) => {
      setState({ msg, bad });
      window.setTimeout(() => setState(null), 4000);
    };
  }, []);
  if (!state) return null;
  return <div className={`toast ${state.bad ? 'bad' : ''}`}>{state.msg}</div>;
}
