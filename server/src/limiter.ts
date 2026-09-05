/**
 * Portero de concurrencia sin dependencias.
 *
 * Limita cuántas tareas pesadas (decodificar/recomprimir imágenes con sharp)
 * corren a la vez. Una ráfaga de 20-30 agentes subiendo capturas en el mismo
 * segundo ya no dispara 30 decodificaciones de bitmap en crudo en paralelo
 * (cada una son varios MB de RAM nativa): se procesan de N en N y el resto
 * espera unos milisegundos. El pico de memoria pasa a ser acotado y predecible
 * independientemente del tamaño de la flota.
 */
export function createLimiter(max: number) {
  const limit = Math.max(1, max | 0);
  let active = 0;
  const queue: (() => void)[] = [];

  const pump = () => {
    while (active < limit && queue.length > 0) {
      active++;
      queue.shift()!();
    }
  };

  return function run<T>(task: () => Promise<T>): Promise<T> {
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
}
