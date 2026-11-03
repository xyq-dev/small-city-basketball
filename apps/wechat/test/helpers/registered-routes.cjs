// Main package pages plus each subpackage root joined to its pages.
// Callers that mean "in the main package" must keep using manifest.pages.
function registeredRoutes(manifest) {
  const routes = [...(manifest.pages || [])];
  for (const pack of manifest.subpackages || []) {
    const base = String(pack.root || '').replace(/\/$/, '');
    for (const page of pack.pages || []) routes.push(base + '/' + page);
  }
  return routes;
}

module.exports = { registeredRoutes };
