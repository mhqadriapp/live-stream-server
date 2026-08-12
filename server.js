const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// वीडियो सेव करने के लिए फोल्डर
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// वीडियो डेटाबेस (JSON फाइल)
const DB_FILE = path.join(__dirname, 'videos.json');

function getVideos() {
    if (!fs.existsSync(DB_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

function saveVideos(videos) {
    fs.writeFileSync(DB_FILE, JSON.stringify(videos, null, 2));
}

// Multer कॉन्फ़िगरेशन
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
        cb(null, uniqueName);
    }
});
const upload = multer({ storage: storage });

// स्टैटिक फाइल्स (अपलोडेड वीडियो देखने के लिए)
app.use('/uploads', express.static(UPLOADS_DIR));

// ग्लोबल स्टेट
let ffmpegProcess = null;
let autoStopTimer = null;
let currentStreamInfo = {
    isLive: false,
    videoId: null,
    videoName: '',
    videoUrl: '',
    startTime: null,
    durationDays: 0,
    endTime: null,
    isLoop: true
};

// 1. सर्वर स्टेटस और लाइव जानकारी प्राप्त करें (APK reopen होने पर यह सिंक करेगा)
app.get('/status', (req, res) => {
    const videos = getVideos();
    res.json({
        streamStatus: currentStreamInfo,
        videos: videos,
        defaultServerUrl: "https://live-stream-server-sfvs.onrender.com"
    });
});

// 2. वीडियो अपलोड एपीआई (प्रोसेसिंग के बाद लिस्ट में जोड़ेगा)
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No video file provided' });

    const videos = getVideos();
    const newVideo = {
        id: Date.now().toString(),
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: (req.file.size / (1024 * 1024)).toFixed(2) + ' MB',
        path: `/uploads/${req.file.filename}`,
        uploadedAt: new Date().toLocaleString('hi-IN')
    };

    videos.push(newVideo);
    saveVideos(videos);

    res.json({ message: 'वीडियो सफलतापूर्वक अपलोड और प्रोसेस हो गया!', video: newVideo, videos });
});

// 3. वीडियो डिलीट करें
app.delete('/videos/:id', (req, res) => {
    const videoId = req.params.id;
    let videos = getVideos();
    const videoToDelete = videos.find(v => v.id === videoId);

    if (videoToDelete) {
        const filePath = path.join(UPLOADS_DIR, videoToDelete.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        videos = videos.filter(v => v.id !== videoId);
        saveVideos(videos);
    }

    res.json({ message: 'वीडियो डिलीट कर दिया गया', videos });
});

// 4. लाइव स्ट्रीम शुरू करें
app.post('/start', (req, res) => {
    const { videoId, streamKey, isLoop, durationDays } = req.body;

    if (!streamKey) return res.status(400).json({ error: 'Stream Key आवश्यक है!' });

    const videos = getVideos();
    const selectedVideo = videos.find(v => v.id === videoId);
    if (!selectedVideo) return res.status(404).json({ error: 'वीडियो नहीं मिला!' });

    const videoFilePath = path.join(UPLOADS_DIR, selectedVideo.filename);
    if (!fs.existsSync(videoFilePath)) return res.status(400).json({ error: 'वीडियो फाइल सर्वर पर मौजूद नहीं है' });

    // यदि पहले से कोई स्ट्रीम चल रही है तो उसे बंद करें
    stopCurrentFFmpeg();

    const youtubeRTMP = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

    // FFmpeg कमांड आर्गुमेंट्स
    const args = [];
    if (isLoop) {
        args.push('-stream_loop', '-1');
    }
    args.push(
        '-re',
        '-i', videoFilePath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'flv',
        youtubeRTMP
    );

    ffmpegProcess = spawn('ffmpeg', args);

    const now = Date.now();
    const daysMs = (parseInt(durationDays) || 1) * 24 * 60 * 60 * 1000;
    const endTime = now + daysMs;

    currentStreamInfo = {
        isLive: true,
        videoId: selectedVideo.id,
        videoName: selectedVideo.originalName,
        videoUrl: selectedVideo.path,
        startTime: now,
        durationDays: durationDays,
        endTime: endTime,
        isLoop: isLoop
    };

    // ऑटो-डिस्कनेक्ट टाइमर सेट करें
    autoStopTimer = setTimeout(() => {
        stopCurrentFFmpeg();
        console.log(`Auto Disconnected stream after ${durationDays} days.`);
    }, daysMs);

    ffmpegProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        if (currentStreamInfo.isLive && code !== 0) {
            currentStreamInfo.isLive = false;
        }
    });

    res.json({ message: '🔴 24x7 लाइव ब्रॉडकास्ट शुरू हो गया!', streamInfo: currentStreamInfo });
});

// 5. लाइव स्ट्रीम रोकें (Disconnect)
app.post('/stop', (req, res) => {
    stopCurrentFFmpeg();
    res.json({ message: 'लाइव स्ट्रीम डिस्कनेक्ट कर दी गई है।' });
});

function stopCurrentFFmpeg() {
    if (autoStopTimer) {
        clearTimeout(autoStopTimer);
        autoStopTimer = null;
    }
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
        ffmpegProcess = null;
    }
    currentStreamInfo = {
        isLive: false,
        videoId: null,
        videoName: '',
        videoUrl: '',
        startTime: null,
        durationDays: 0,
        endTime: null,
        isLoop: true
    };
}

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
