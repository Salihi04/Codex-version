import { Router } from 'express';
import { bookingById, bookingsByEmail, cancel, create, reset, slots } from '../controllers/clinicController';
import { asyncHandler } from '../utils/http';

const router = Router();
router.post('/reset', asyncHandler(reset));
router.get('/slots', asyncHandler(slots));
router.post('/bookings', asyncHandler(create));
router.get('/bookings', asyncHandler(bookingsByEmail));
router.get('/bookings/:id', asyncHandler(bookingById));
router.delete('/bookings/:id', asyncHandler(cancel));

export default router;
