const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

let uploadedFilePath = '';

// यह WEBM और MP4 दोनों को उनके असली नाम से सेव करेगा
const storage = multer.diskStorage({
    destination: './',
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.mp4';
        uploadedFilePath = 'video' + ext;
        cb(null, uploadedFilePath);
    }
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
    if (!uploadedFilePath || !fs.existsSync(uploadedFilePath)) return res.status(400).json({ error: 'Please upload a video first' });

    if (ffmpegProcess) ffmpegProcess.kill('SIGKILL');

    const youtubeRTMP = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

    // WEBM को YouTube के लिए H.264 में कन्वर्ट करने का अल्ट्राफास्ट कमांड
    const args = [
        '-stream_loop', '-1',
        '-re',
        '-i', uploadedFilePath,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-b:v', '2500k',
        '-maxrate', '2500k',
        '-bufsize', '5000k',
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
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
