/**
 * Save a text file to the device directly: the browser's own download, which
 * on a phone puts the file in Files → Downloads (iOS) or Downloads (Android)
 * the moment the button is pressed, with no extra sheet to get through.
 *
 * Staff downloads (venue JSON, walk data, test-walk logs) all use this, so
 * pressing Download always does the same thing. An earlier version offered the
 * phone's share sheet instead, which saves nothing unless "Save to Files" is
 * then picked, and a dismissed sheet looked exactly like a download that had
 * silently failed.
 *
 * @param {string} name   The file name, e.g. `brains-demo-2026-01-01-0000.venue.json`.
 * @param {string} text   The file's contents.
 * @param {Object} [options]
 * @param {string} [options.type='application/json']
 * @param {Document} [options.document]
 * @param {typeof URL} [options.URL]
 * @returns {boolean} Always true: a browser gives no way to know whether the download completed.
 */
export function saveFile(name, text, options = {}) {
  const doc = options.document ?? globalThis.document;
  const urls = options.URL ?? globalThis.URL;
  const blob = new Blob([text], { type: options.type ?? 'application/json' });
  const url = urls.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start reading the blob before it is released.
  setTimeout(() => urls.revokeObjectURL(url), 1000);
  return true;
}
