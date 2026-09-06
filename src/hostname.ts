/** True when `host` is a valid DNS hostname (labels, length, charset). */
export function isHostname(host: string): boolean {
  const labels = host.split(".");
  return (
    host.length <= 253 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
    )
  );
}
