// Test-only synthetic device/guide. Never contacts or tunes a real HDHomeRun.
process.env.PORT ||= '8181';
process.env.HDHOMERUN_HOST = 'synthetic-device.invalid';
process.env.WEBVTT_SIDECAR_MODE = 'off';
const hdhr = require('../src/hdhomerun');
const guide = require('../src/guide');
const record = require('../src/hdhomerunRecord');
const cache = require('../src/cache');
let scenario = 'normal';
let scanning = false;
const now = Math.floor(Date.now() / 1000);
const names = ['PBS', 'NBC', 'ABC', 'CBS', 'FOX', 'Local News', 'Movies', 'Documentary', 'A very long channel name to check narrow-screen behavior', 'Hidden channel'];
const titles = ['Nature: A World of Wonder', 'Today', 'Good Morning America', 'The Price Is Right', 'Morning News', 'Your Local Forecast', 'A Classic Film', 'Exploring the Coast', 'A long program title with enough words to exercise wrapping on a mobile phone', 'Hidden Program'];
const channels = names.map((name, index) => ({
  GuideNumber: String(index + 2) + '.1', GuideName: name, HD: true, Enabled: index === 9 ? 0 : 1, Favorite: index === 0 || index === 3, SignalStrength: 95, SignalQuality: 98, VideoCodec: 'MPEG2', AudioCodec: 'AC3',
  Guide: Array.from({ length: 9 }, (_, i) => ({ Title: i === 0 ? titles[index] : ['Up next: The Afternoon Show', 'News at Noon', 'Travel Stories'][i % 3], StartTime: now - 900 + i * 1800, EndTime: now + 900 + i * 1800, EpisodeTitle: 'Synthetic episode', Synopsis: 'Synthetic program information for interface testing. No broadcast or recording is available.', EpisodeNumber: 'S1E1', SeriesID: 'fixture' })),
}));
function checked(value) {
  if (scenario === 'error') throw new Error('Synthetic device is unavailable. Check your connection and try again.');
  return scenario === 'empty' && Array.isArray(value) ? [] : value;
}
hdhr.getDeviceInfo = async () => checked({ FriendlyName: 'Synthetic HDHomeRun', ModelNumber: 'HDHR5-4US', FirmwareName: 'hdhomerun', FirmwareVersion: '20260301', DeviceID: 'TEST0001', TunerCount: 4 });
hdhr.getLineup = async () => checked(channels);
hdhr.getLineupStatus = async () => checked({ ScanInProgress: scanning ? 1 : 0, Progress: 42, Found: 10, Source: 'Antenna', SourceList: ['Antenna', 'Cable'] });
hdhr.startScan = async source => { if (!['Antenna', 'Cable'].includes(source)) throw new Error('Missing source'); scanning = true; };
hdhr.abortScan = async () => { scanning = false; };
hdhr.setChannelFlag = async (number, mode) => {
  if (!['+', '-', 'x'].includes(mode)) throw new Error('Flag was not percent-encoded correctly');
  const ch = channels.find(c => c.GuideNumber === number);
  ch.Favorite = mode === '+';
  ch.Enabled = mode === 'x' ? 0 : 1;
};
hdhr.getTunerStatus = async () => checked([{ Resource: 'Tuner 0', VctNumber: '2.1', VctName: 'PBS', SignalStrengthPercent: 92, SignalQualityPercent: 100, SymbolQualityPercent: 100, NetworkRate: 1500000 }, { Resource: 'Tuner 1' }]);
guide.getGuide = async () => checked(channels);
const recording = { id: 'abcdef', Title: 'Synthetic recording', EpisodeTitle: 'A sample episode', Synopsis: 'Synthetic test recording; no video is available.', ChannelNumber: '2.1', ChannelName: 'PBS', Resume: true };
record.isConfigured = () => scenario !== 'dvr-off';
record.getRecordings = async () => checked([{ Title: recording.Title, episodes: [recording] }]);
record.getRecording = async () => recording;
record.getPlaybackUrl = () => 'synthetic-recording';
record.deleteRecording = async () => {};
record.recordCurrentAiring = async () => {};
function mockModule(path, exports) { require.cache[require.resolve(path)] = { id: require.resolve(path), filename: require.resolve(path), loaded: true, exports }; }
mockModule('../src/stream', { STREAM_PROFILES: ['low', 'medium', 'high'], DEFAULT_PROFILE: 'medium', start() {}, touch() {}, isReady: () => ({ ready: false, failed: true, error: 'Synthetic fixture has no live tuner' }) });
mockModule('../src/recordingStream', { PROFILES: { medium: {} }, start() {}, isReady: () => ({ ready: false, error: 'Synthetic fixture has no video' }) });
process.on('message', message => {
  scenario = message.scenario;
  cache.clear();
  process.send?.({ scenario });
});
require('../server');
