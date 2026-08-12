const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const port = process.env.PORT || 3000;

// वीडियो सेव करने के लिए फोल्डर
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// वीडियो प्लेयर में चलाने के लिए स्टैटिक फोल्डर
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage: storage });

let ffmpegProcess = null;
let streamTimer = null;

// सर्वर का स्टेट (ताकि ऐप बंद होने पर भी डेटा सेव रहे)
let streamState = {
    isLive: false,
    activeVideos: [],
    endTime: null,
    loop: true,
    streamKey: ''
};

// स्टेट चेक करने का API (ऐप खुलते ही यह चेक होगा)
app.get('/status', (req, res) => {
    // अगर टाइम पूरा हो गया है तो स्ट्रीम बंद कर दो
    if (streamState.endTime && Date.now() > streamState.endTime) {
        stopStreaming();
    }
    res.json({
        ...streamState,
        remainingTime: streamState.endTime ? Math.max(0, streamState.endTime - Date.now()) : null
    });
});

// मल्टीपल वीडियो अपलोड
app.post('/upload', upload.array('videos', 10), (req, res) => {
    res.json({ message: 'Videos Uploaded & Processed Successfully!' });
});

// अपलोड किए गए वीडियो की लिस्ट
app.get('/videos', (req, res) => {
    fs.readdir(UPLOADS_DIR, (err, files) => {
        if (err) return res.json([]);
        res.json(files.filter(f => f.endsWith('.mp4') || f.endsWith('.webm')));
    });
});

const stopStreaming = () => {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
        ffmpegProcess = null;
    }
    if (streamTimer) {
        clearTimeout(streamTimer);
        streamTimer = null;
    }
    streamState.isLive = false;
    streamState.endTime = null;
    streamState.activeVideos = [];
};

// स्ट्रीम स्टार्ट करने का API
app.post('/start', (req, res) => {
    const { streamKey, videos, durationDays, loop } = req.body;
    
    if (!streamKey) return res.status(400).json({ error: 'Stream key is required' });
    if (!videos || videos.length === 0) return res.status(400).json({ error: 'Please select at least one video' });

    stopStreaming(); // पुरानी स्ट्रीम बंद करें

    // मल्टीपल वीडियो के लिए प्लेलिस्ट फाइल बनाएं
    const playlistPath = path.join(__dirname, 'playlist.txt');
    const playlistContent = videos.map(v => `file '${path.join(UPLOADS_DIR, v).replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(playlistPath, playlistContent);

    const youtubeRTMP = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;
    const loopArg = loop ? '-1' : '0';
    
    // FFmpeg कमांड (Multiple files with copy codec)
    const args = [
        '-re',
        '-stream_loop', loopArg,
        '-f', 'concat',
        '-safe', '0',
        '-i', 'playlist.txt',
        '-c:v', 'copy', 
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'flv',
        youtubeRTMP
    ];

    ffmpegProcess = spawn('ffmpeg', args);
    
    ffmpegProcess.on('close', () => {
        streamState.isLive = false;
    });

    // स्टेट अपडेट करें
    streamState.isLive = true;
    streamState.activeVideos = videos;
    streamState.loop = loop;
    streamState.streamKey = streamKey;
    
    // ऑटो-डिस्कनेक्ट टाइमर सेट करें
    if (durationDays && durationDays > 0) {
        const ms = durationDays * 24 * 60 * 60 * 1000;
        streamState.endTime = Date.now() + ms;
        streamTimer = setTimeout(() => {
            stopStreaming();
        }, ms);
    } else {
        streamState.endTime = null; // अनलिमिटेड
    }

    res.json({ message: 'Live Stream Started Successfully!' });
});

// स्ट्रीम रोकने का API
app.post('/stop', (req, res) => {
    stopStreaming();
    res.json({ message: 'Stream Disconnected Successfully' });
});

app.listen(port, () => console.log(`Server is running on port ${port}`));
