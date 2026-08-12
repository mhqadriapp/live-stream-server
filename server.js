const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

const storage = multer.diskStorage({
    destination: './',
    filename: (req, file, cb) => cb(null, 'video.mp4')
});
const upload = multer({ storage: storage });

let ffmpegProcess = null;

// UptimeRobot के लिए ताकि सर्वर 24/7 जागता रहे
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

    // -c:v copy का इस्तेमाल ताकि Render का सर्वर क्रैश न हो
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
