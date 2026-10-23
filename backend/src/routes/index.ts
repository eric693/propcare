import { Router } from 'express';
import { requireStaff, requireAdmin, requireCommunity, canWrite } from '../middleware/auth';
import { requireResident } from '../middleware/residentAuth';
import { loginRateLimit } from '../middleware/loginGuard';
import * as auth from '../controllers/authController';
import * as comm from '../controllers/communityController';
import * as unit from '../controllers/unitController';
import * as fee from '../controllers/feeController';
import * as svc from '../controllers/serviceController';
import * as vendor from '../controllers/vendorController';
import * as meet from '../controllers/meetingController';
import * as res from '../controllers/residentController';

const router = Router();

// ── 公開 ──
router.post('/auth/login', loginRateLimit, auth.login);
router.get('/auth/demo', auth.demoAccount);
router.post('/resident/login', loginRateLimit, res.residentLogin);

// ── 住戶端 ──
const R = Router();
R.use(requireResident);
R.get('/me', res.residentMe);
R.put('/password', res.residentPassword);
R.get('/home', res.residentHome);
R.get('/bills', res.residentBills);
R.get('/packages', res.residentPackages);
R.get('/announcements', res.residentAnnouncements);
R.post('/announcements/:id/read', res.readAnnouncement);
R.get('/facilities', res.residentFacilities);
R.get('/facilities/:id/slots', res.residentSlots);
R.get('/bookings', res.residentBookings);
R.post('/bookings', res.residentBook);
R.delete('/bookings/:id', res.residentCancelBooking);
R.get('/repairs', res.residentRepairs);
R.post('/repairs', res.residentCreateRepair);
R.get('/report', res.residentReport);
R.get('/meetings', res.residentMeetings);
R.post('/line/code', res.residentLineCode);
R.delete('/line', res.residentLineUnbind);
router.use('/resident', R);

// ── 員工端：不需選社區 ──
router.use(requireStaff);
router.get('/auth/me', auth.me);
router.put('/auth/me', auth.updateMe);
router.post('/auth/line/code', auth.staffLineCode);
router.delete('/auth/line', auth.staffLineUnbind);
router.get('/communities', comm.listCommunities);
router.post('/communities', requireAdmin, comm.createCommunity);
router.get('/overview', comm.overview);
router.get('/users', requireAdmin, comm.listUsers);
router.post('/users', requireAdmin, comm.saveUser);
router.put('/users/:id', requireAdmin, comm.saveUser);

// ── 員工端：社區範圍（X-Community 標頭）──
const C = Router();
C.use(requireCommunity);
C.get('/community', comm.getCommunity);
C.put('/community', requireAdmin, comm.updateCommunity);
C.get('/dashboard', comm.dashboard);
C.get('/audit', comm.auditLogs);

C.get('/units', unit.listUnits);
C.post('/units', canWrite, unit.saveUnit);
C.post('/units/import', canWrite, unit.importUnits);
C.put('/units/:id', canWrite, unit.saveUnit);
C.delete('/units/:id', canWrite, unit.deleteUnit);
C.post('/residents', canWrite, unit.saveResident);
C.put('/residents/:id', canWrite, unit.saveResident);
C.delete('/residents/:id', canWrite, unit.deleteResident);
C.post('/residents/:id/reset-password', canWrite, unit.resetResidentPassword);
C.get('/parking', unit.listParking);
C.post('/parking', canWrite, unit.saveParking);
C.put('/parking/:id', canWrite, unit.saveParking);
C.delete('/parking/:id', canWrite, unit.deleteParking);

C.get('/bills', fee.listBills);
C.post('/bills/generate', canWrite, fee.createBills);
C.put('/bills/:id', canWrite, fee.updateBill);
C.get('/payments', fee.listPayments);
C.post('/payments', canWrite, fee.pay);
C.post('/payments/unit', canWrite, fee.payUnit);
C.post('/payments/:id/void', canWrite, fee.cancelPayment);
C.get('/arrears', fee.getArrears);
C.get('/units/:unitId/statement', fee.unitStatement);
C.get('/ledger', fee.listLedger);
C.post('/ledger', canWrite, fee.createLedger);
C.post('/ledger/:id/approve', fee.approveLedger);   // 委員可核准
C.delete('/ledger/:id', canWrite, fee.deleteLedger);
C.get('/report', fee.report);

C.get('/packages', svc.listPackages);
C.post('/packages', canWrite, svc.createPackage);
C.post('/packages/pickup', canWrite, svc.pickupPackage);
C.post('/packages/:id/return', canWrite, svc.returnPackage);
C.get('/facilities', svc.listFacilities);
C.post('/facilities', canWrite, svc.saveFacility);
C.put('/facilities/:id', canWrite, svc.saveFacility);
C.get('/facilities/:id/slots', svc.facilitySlots);
C.get('/bookings', svc.listBookings);
C.post('/bookings', canWrite, svc.staffBooking);
C.delete('/bookings/:id', canWrite, svc.cancelBooking);
C.get('/repairs', svc.listRepairs);
C.post('/repairs', canWrite, svc.createRepair);
C.put('/repairs/:id', canWrite, svc.updateRepair);
C.get('/announcements', svc.listAnnouncements);
C.post('/announcements', canWrite, svc.saveAnnouncement);
C.put('/announcements/:id', canWrite, svc.saveAnnouncement);
C.delete('/announcements/:id', canWrite, svc.deleteAnnouncement);

C.get('/vendors', vendor.listVendors);
C.post('/vendors', canWrite, vendor.saveVendor);
C.put('/vendors/:id', canWrite, vendor.saveVendor);
C.delete('/vendors/:id', canWrite, vendor.deleteVendor);
C.get('/contracts', vendor.listContracts);
C.post('/contracts', canWrite, vendor.saveContract);
C.put('/contracts/:id', canWrite, vendor.saveContract);
C.delete('/contracts/:id', canWrite, vendor.deleteContract);
C.get('/inspections', vendor.listInspections);
C.post('/inspections', canWrite, vendor.saveInspection);
C.put('/inspections/:id', canWrite, vendor.saveInspection);
C.post('/inspections/:id/complete', canWrite, vendor.completeInspection);
C.delete('/inspections/:id', canWrite, vendor.deleteInspection);

C.get('/meetings', meet.listMeetings);
C.post('/meetings', canWrite, meet.saveMeeting);
C.get('/meetings/:id', meet.getMeeting);
C.put('/meetings/:id', canWrite, meet.saveMeeting);
C.delete('/meetings/:id', canWrite, meet.deleteMeeting);
C.post('/meetings/:id/attendance', canWrite, meet.setAttendance);
C.post('/meetings/:id/motions', canWrite, meet.saveMotion);
C.put('/meetings/:id/motions/:motionId', canWrite, meet.saveMotion);
C.delete('/meetings/:id/motions/:motionId', canWrite, meet.deleteMotion);
C.put('/meetings/:id/motions/:motionId/votes', canWrite, meet.setVotes);

router.use(C);

export default router;
