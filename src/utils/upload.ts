import multer from 'multer';
import path from 'path';
import fs from 'fs';

const dir = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const maxMB = Number(process.env.MAX_FILE_SIZE_MB || 50);

export const upload = multer({
  storage,
  limits: { fileSize: maxMB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Разрешаем изображения, видео, аудио, документы
    const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|mp3|ogg|wav|m4a|pdf|docx|doc|zip|txt)$/i;
    if (allowed.test(file.originalname)) return cb(null, true);
    cb(new Error(`Недопустимый тип файла: ${file.originalname}`));
  },
});
