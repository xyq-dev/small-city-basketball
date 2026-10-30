const media = require('./utils/media');
const participantMaterials = require('./utils/participant-materials');

// Remove preview files a previous run could not delete (only scb-media- files it recorded).
App({
  onLaunch() {
    media.sweepTemps(wx);
    participantMaterials.sweepTemps(wx);
  },
});
