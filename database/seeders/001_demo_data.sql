-- Seed data for FaceVision
-- Run after 001_init_schema.sql

-- Demo detection records (sample data for development)
INSERT INTO detection_records (id, timestamp, mode, face_count, average_confidence, image_name, user_session_id)
VALUES
    ('demo-001', EXTRACT(EPOCH FROM NOW() - INTERVAL '2 days') * 1000, 'upload', 3, 0.88, 'group-photo.jpg', 'demo-session'),
    ('demo-002', EXTRACT(EPOCH FROM NOW() - INTERVAL '1 day') * 1000, 'camera', 1, 0.94, NULL, 'demo-session'),
    ('demo-003', EXTRACT(EPOCH FROM NOW() - INTERVAL '6 hours') * 1000, 'upload', 2, 0.81, 'portraits.png', 'demo-session')
ON CONFLICT (id) DO NOTHING;

-- Demo face records
INSERT INTO face_records (detection_id, confidence, box_x, box_y, box_width, box_height, landmarks)
VALUES
    ('demo-001', 0.92, 120.0, 80.0, 200.0, 240.0,
     '{"rightEye":{"x":180,"y":170},"leftEye":{"x":260,"y":168},"nose":{"x":220,"y":210},"rightMouth":{"x":185,"y":270},"leftMouth":{"x":255,"y":268}}'),
    ('demo-001', 0.87, 420.0, 100.0, 190.0, 230.0,
     '{"rightEye":{"x":475,"y":185},"leftEye":{"x":550,"y":183},"nose":{"x":512,"y":225},"rightMouth":{"x":480,"y":285},"leftMouth":{"x":545,"y":283}}'),
    ('demo-001', 0.85, 700.0, 90.0, 195.0, 235.0,
     '{"rightEye":{"x":758,"y":178},"leftEye":{"x":835,"y":176},"nose":{"x":796,"y":218},"rightMouth":{"x":762,"y":278},"leftMouth":{"x":828,"y":276}}'),
    ('demo-002', 0.94, 300.0, 120.0, 220.0, 260.0,
     '{"rightEye":{"x":365,"y":215},"leftEye":{"x":455,"y":213},"nose":{"x":410,"y":260},"rightMouth":{"x":370,"y":330},"leftMouth":{"x":448,"y":328}}'),
    ('demo-003', 0.83, 150.0, 70.0, 180.0, 220.0,
     '{"rightEye":{"x":205,"y":155},"leftEye":{"x":275,"y":153},"nose":{"x":240,"y":190},"rightMouth":{"x":210,"y":240},"leftMouth":{"x":270,"y":238}}'),
    ('demo-003', 0.79, 480.0, 110.0, 175.0, 215.0,
     '{"rightEye":{"x":530,"y":192},"leftEye":{"x":595,"y":190},"nose":{"x":562,"y":228},"rightMouth":{"x":535,"y":275},"leftMouth":{"x":590,"y":273}}')
ON CONFLICT DO NOTHING;

-- Demo face gallery
INSERT INTO face_gallery (name, user_session_id)
VALUES
    ('Person A', 'demo-session'),
    ('Person B', 'demo-session')
ON CONFLICT DO NOTHING;
