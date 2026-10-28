const media = require('./utils/media');

// Remove preview files a previous run could not delete (only scb-media- files it recorded).
App({
  onLaunch() {
    media.sweepTemps(wx);
  },
});
