"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dir = process.env.UPLOADS_DIR || path_1.default.join(__dirname, '../../uploads');
if (!fs_1.default.existsSync(dir))
    fs_1.default.mkdirSync(dir, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, name);
    },
});
const maxMB = Number(process.env.MAX_FILE_SIZE_MB || 50);
exports.upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: maxMB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        // Разрешаем изображения, видео, аудио, документы
        const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|mp3|ogg|wav|m4a|pdf|docx|doc|zip|txt)$/i;
        if (allowed.test(file.originalname))
            return cb(null, true);
        cb(new Error(`Недопустимый тип файла: ${file.originalname}`));
    },
});
//# sourceMappingURL=upload.js.map