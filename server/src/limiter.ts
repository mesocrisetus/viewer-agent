/**
 * Portero de concurrencia con cola acotada (sin dependencias).
 *
 * - `max`: cuántas tareas pesadas (sharp: decodificar cabecera + miniatura)
 *   corren a la vez. Acota el pico de memoria NATIVA.
 * - `maxQueued`: cuántas pueden estar ESPERANDO turno. Si se supera, `run()`
 *   rechaza al instante con `OverloadError` en vez de encolar indefinidamente.
 *   Esto es el backpressure: quien llama (la ruta HTTP) responde 503 y el
 *   agente reintenta luego desde su buffer local. Sin este tope, una ráfaga
 *   sostenida (p. ej. 20 agentes volcando backlog tras un redespliegue) hacía
 *   crecer la cola sin límite -> cada entrada retiene su imagen + el contexto
 *   de la petición -> el heap de Node explota y el proceso entra en bucle de
 *   caída.
 */
export class OverloadError extends Error {
  constructor() {
    super('OVERLOADED');
    this.name = 'OverloadError';
  }
}

export function createLimiter(max: number, maxQueued = 40) {
  const limit = Math.max(1, max | 0);
  const capacity = Math.max(1, maxQueued | 0);
  let active = 0;
  const queue: (() => void)[] = [];

  const pump = () => {
    while (active < limit && queue.length > 0) {
      active++;
      queue.shift()!();
    }
  };

  const run = <T>(task: () => Promise<T>): Promise<T> => {
    if (queue.length >= capacity) return Promise.reject(new OverloadError());
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      });
      pump();
    });
  };

  run.stats = () => ({ active, queued: queue.length, limit, capacity });
  return run;
}
