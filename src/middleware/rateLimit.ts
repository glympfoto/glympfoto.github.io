import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  legacyHeaders: false,
  limit: 600,
  message: { error: 'too_many_requests' },
  standardHeaders: 'draft-7',
  windowMs: 15 * 60 * 1000,
});

export const uploadLimiter = rateLimit({
  legacyHeaders: false,
  limit: 60,
  message: { error: 'too_many_requests' },
  standardHeaders: 'draft-7',
  windowMs: 60 * 60 * 1000,
});

export const viewerOpenLimiter = rateLimit({
  legacyHeaders: false,
  limit: 60,
  message: { error: 'too_many_requests' },
  standardHeaders: 'draft-7',
  windowMs: 60 * 1000,
});

export const viewerImageLimiter = rateLimit({
  legacyHeaders: false,
  limit: 120,
  message: { error: 'too_many_requests' },
  standardHeaders: 'draft-7',
  windowMs: 60 * 1000,
});

// Login admin — tetap ketat tapi sedikit dilonggarkan biar admin tidak terblokir saat cek
export const loginLimiter = rateLimit({
  legacyHeaders: false,
  limit: 15,
  message: { error: 'too_many_requests' },
  standardHeaders: 'draft-7',
  windowMs: 15 * 60 * 1000,
});

// Guest upload tanpa token — dilonggarkan biar tidak ganggu pemakaian wajar
export const guestUploadLimiter = rateLimit({
  legacyHeaders: false,
  limit: 20,
  message: { error: 'too_many_requests' },
  standardHeaders: 'draft-7',
  windowMs: 60 * 60 * 1000,
});
