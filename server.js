const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

// वीडियो को हमेशा video.mp4 नाम से सेव करेगा
const storage = multer.diskStorage({
    destination: './',
    filename: (req, file, cb) => cb(null, 'video.mp4')
});
const upload = multer({ storage: storage });

let ffmpegProcess = null;

app.get('/ping', (req, res) => res.send('Server is awake!'));

app.post('/upload', upload.single('video'), (req, res) => {
    res.json({ message: 'Video Uploaded Successfully!' });
});

app.post('/start', express.json(), (req, res) => {
    const { streamKey } = req.body;
    if (!streamKey) return res.status(400).json({ error: 'Stream key is required' });
    if (!fs.existsSync('video.mp4')) return res.status(400).json({ error: 'Please upload a video first' });

    if (ffmpegProcess) ffmpegProcess.kill('SIGKILL');

    const youtubeRTMP = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

    // -c:v copy सबसे ज़रूरी है, यह सर्वर पर 0% लोड डालेगा और वीडियो मक्खन की तरह चलेगा
    const args = [
        '-stream_loop', '-1',
        '-re',
        '-i', 'video.mp4',
        '-c:v', 'copy', 
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'flv',
        youtubeRTMP
    ];

    ffmpegProcess = spawn('ffmpeg', args);
    res.json({ message: 'Live Stream Started Successfully!' });
});

app.post('/stop', (req, res) => {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
        ffmpegProcess = null;
        res.json({ message: 'Stream Stopped' });
    } else {
        res.json({ message: 'No stream is running' });
    }
});

app.listen(port, () => console.log(`Server is running on port ${port}`));
