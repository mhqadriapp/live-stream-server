const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

// CORS और टाइमआउट बफर बढ़ाएं ताकि अपलोड बीच में न टूटे
app.use(cors());
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ extended: true, limit: '1000mb' }));

const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

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

// हाई-स्पीड बफर के साथ स्टोरेज कॉन्फ़िगरेशन
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
        cb(null, uniqueName);
    }
});

// फ़ास्ट फाइल अपलोडर
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2000 * 1024 * 1024 } // 2 GB Max File Limit
});

app.use('/uploads', express.static(UPLOADS_DIR));

let activeStreams = {}; 

app.get('/status', (req, res) => {
    const activeList = Object.keys(activeStreams).map(id => {
        const s = activeStreams[id];
        return {
            streamId: id,
            videoId: s.videoId,
            videoName: s.videoName,
            streamKey: s.streamKey,
            startTime: s.startTime,
            durationDays: s.durationDays,
            endTime: s.endTime,
            isLoop: s.isLoop,
            videoUrl: s.videoUrl
        };
    });

    res.json({
        activeStreams: activeList,
        serverVideos: getVideos(),
        defaultServerUrl: "https://live-stream-server-sfvs.onrender.com"
    });
});

// हाई-स्पीड वीडियो अपलोड रूट
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'फाइल अपलोड नहीं हुई' });

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

    res.json({ message: 'वीडियो सर्वर पर फ़ास्ट अपलोड हो गया!', video: newVideo, videos });
});

app.delete('/videos/:id', (req, res) => {
    const videoId = req.params.id;
    let videos = getVideos();
    const videoToDelete = videos.find(v => v.id === videoId);

    if (videoToDelete) {
        Object.keys(activeStreams).forEach(streamId => {
            if (activeStreams[streamId].videoId === videoId) {
                stopStreamById(streamId);
            }
        });

        const filePath = path.join(UPLOADS_DIR, videoToDelete.filename);
        if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch(e) {}
        }
        videos = videos.filter(v => v.id !== videoId);
        saveVideos(videos);
    }

    res.json({ message: 'वीडियो डिलीट कर दिया गया!', videos });
});

app.post('/start', (req, res) => {
    const { videoId, streamKey, isLoop, durationDays } = req.body;

    if (!streamKey) return res.status(400).json({ error: 'Stream Key आवश्यक है!' });

    const videos = getVideos();
    const selectedVideo = videos.find(v => v.id === videoId);
    if (!selectedVideo) return res.status(404).json({ error: 'वीडियो नहीं मिला!' });

    const videoFilePath = path.join(UPLOADS_DIR, selectedVideo.filename);
    if (!fs.existsSync(videoFilePath)) return res.status(400).json({ error: 'वीडियो फाइल सर्वर पर नहीं है' });

    const streamId = 'stream_' + Date.now();
    const youtubeRTMP = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

    const args = [];
    if (isLoop) {
        args.push('-stream_loop', '-1');
    }
    args.push(
        '-re',
        '-i', videoFilePath,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'flv',
        youtubeRTMP
    );

    const ffmpegProc = spawn('ffmpeg', args);

    const now = Date.now();
    const daysMs = (parseInt(durationDays) || 1) * 24 * 60 * 60 * 1000;
    const endTime = now + daysMs;

    const timer = setTimeout(() => {
        stopStreamById(streamId);
    }, daysMs);

    activeStreams[streamId] = {
        process: ffmpegProc,
        videoId: selectedVideo.id,
        videoName: selectedVideo.originalName,
        videoUrl: selectedVideo.path,
        streamKey: streamKey,
        startTime: now,
        durationDays: durationDays,
        endTime: endTime,
        isLoop: isLoop,
        timer: timer
    };

    ffmpegProc.on('close', () => {
        delete activeStreams[streamId];
    });

    res.json({ message: `🔴 "${selectedVideo.originalName}" लाइव ब्रॉडकास्ट चालू हो गया!`, streamId });
});

app.post('/stop', (req, res) => {
    const { streamId } = req.body;
    if (streamId) {
        stopStreamById(streamId);
        res.json({ message: 'लाइव ब्रॉडकास्ट डिस्कनेक्ट कर दिया गया है।' });
    } else {
        res.status(400).json({ error: 'Stream ID नहीं मिली' });
    }
});

function stopStreamById(streamId) {
    if (activeStreams[streamId]) {
        if (activeStreams[streamId].timer) clearTimeout(activeStreams[streamId].timer);
        if (activeStreams[streamId].process) activeStreams[streamId].process.kill('SIGKILL');
        delete activeStreams[streamId];
    }
}

app.listen(PORT, () => console.log(`Fast Server running on port ${PORT}`));
