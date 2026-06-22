// Silenciar el "Worker terminate" de Spark: al desmontar el Viewer3D (p.ej. al abrir el AR)
// dispose() termina los web workers de Spark y, si había una tarea en vuelo, su promesa
// rechaza ASÍNCRONAMENTE con "Worker terminate" — ruido benigno de teardown que un try/catch
// sincrónico no puede atrapar. Lo registramos acá (lo más temprano posible en el cliente) para
// silenciarlo también frente al overlay de error de Next dev, no solo en la consola de prod.
if (typeof window !== 'undefined' && !window.__xrsWorkerTerminateGuard) {
  window.__xrsWorkerTerminateGuard = true;
  const isWorkerTerminate = (msg) => /worker\s*terminate/i.test(msg || '');
  window.addEventListener('unhandledrejection', (e) => {
    if (isWorkerTerminate(e?.reason?.message || String(e?.reason || ''))) {
      e.preventDefault();
      e.stopImmediatePropagation?.();
    }
  }, true);
  window.addEventListener('error', (e) => {
    if (isWorkerTerminate(e?.message || e?.error?.message)) {
      e.preventDefault();
      e.stopImmediatePropagation?.();
    }
  }, true);
}
