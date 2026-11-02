import type { StudioFieldDefinition } from './schema-validator.js';

export interface CanonicalProductRecord {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  status: 'active' | 'inactive';
}

export const FTX_STUDIO_PRODUCTS_CATEGORIES = [
  'Accessories',
  'Audio & Video',
  'Automotive',
  'Cloud & Storage',
  'Computer Peripherals',
  'Cybersecurity',
  'Developer Tools',
  'Electronics',
  'Fitness',
  'Home',
  'Industrial IoT',
  'Kitchen',
  'Lab Equipment',
  'Learning & STEM',
  'Monitoring & Sensors',
  'Networking',
  'Office',
  'Outdoor & Travel',
  'Packaging & Logistics',
  'Personal Care',
  'Power & Backup',
  'Safety & Security',
  'Smart Devices',
  'Software & Licenses',
] as const;

export const FTX_STUDIO_PRODUCTS_MANIFEST = {
  dataset: 'FortiX API Studio Products',
  version: '1.1.0',
  totalRecords: 100,
  categoryCount: 24,
  priceCurrency: 'INR',
  statusDistribution: { active: 94, inactive: 6 },
} as const;

export const STUDIO_PRODUCTS_FIELDS: StudioFieldDefinition[] = [
  { name: 'sku', type: 'string', required: true, unique: true, maxLength: 40, description: 'Unique stock keeping unit' },
  { name: 'name', type: 'string', required: true, maxLength: 140, description: 'Product display title' },
  { name: 'description', type: 'string', required: false, maxLength: 500, description: 'Concise specification summary' },
  { name: 'category', type: 'string', required: true, maxLength: 80, description: 'Catalogue category (24 canonical groups)' },
  { name: 'price', type: 'number', required: true, min: 0, max: 10_000_000, description: 'Unit price in INR' },
  { name: 'stock', type: 'integer', required: true, min: 0, max: 1_000_000, description: 'Available inventory units' },
  {
    name: 'status',
    type: 'enum',
    required: true,
    enumValues: ['active', 'inactive'],
    description: 'Catalogue availability state',
  },
];

export const STUDIO_CUSTOMERS_FIELDS: StudioFieldDefinition[] = [
  { name: 'name', type: 'string', required: true, maxLength: 120, description: 'Customer full name' },
  { name: 'email', type: 'string', required: true, unique: true, maxLength: 160, description: 'Primary contact email' },
  { name: 'tier', type: 'enum', required: true, enumValues: ['standard', 'pro', 'enterprise'], description: 'Account tier' },
  { name: 'status', type: 'enum', required: true, enumValues: ['active', 'suspended'], description: 'Account status' },
];

export const STUDIO_ORDERS_FIELDS: StudioFieldDefinition[] = [
  { name: 'customerId', type: 'string', required: true, maxLength: 64, description: 'Reference customer identifier' },
  { name: 'productId', type: 'string', required: true, maxLength: 64, description: 'Primary ordered product identifier' },
  { name: 'quantity', type: 'integer', required: true, min: 1, max: 10_000, description: 'Units ordered' },
  { name: 'total', type: 'number', required: true, min: 0, max: 100_000_000, description: 'Order total in INR' },
  {
    name: 'status',
    type: 'enum',
    required: true,
    enumValues: ['pending', 'paid', 'shipped', 'cancelled'],
    description: 'Order lifecycle status',
  },
];

export const FTX_STUDIO_PRODUCTS_SEED: CanonicalProductRecord[] = [
  { id: 'prod_0001', sku: 'SKU-ELE-001', name: 'Wireless Mouse', description: 'Ergonomic 2.4 GHz wireless mouse with adjustable DPI.', category: 'Electronics', price: 799.0, stock: 84, status: 'active' },
  { id: 'prod_0002', sku: 'SKU-ELE-002', name: 'Mechanical Keyboard', description: 'Tenkeyless mechanical keyboard with tactile switches.', category: 'Electronics', price: 3499.0, stock: 32, status: 'active' },
  { id: 'prod_0003', sku: 'SKU-ELE-003', name: 'USB-C Hub 7-in-1', description: 'USB-C hub with HDMI, USB-A, USB-C PD and SD card ports.', category: 'Electronics', price: 2199.0, stock: 41, status: 'active' },
  { id: 'prod_0004', sku: 'SKU-ELE-004', name: 'Bluetooth Headphones', description: 'Over-ear wireless headphones with built-in microphone.', category: 'Electronics', price: 2799.0, stock: 27, status: 'active' },
  { id: 'prod_0005', sku: 'SKU-ELE-005', name: '1080p Webcam', description: 'Full HD webcam with privacy shutter and automatic light correction.', category: 'Electronics', price: 1899.0, stock: 19, status: 'active' },
  { id: 'prod_0006', sku: 'SKU-ELE-006', name: 'Portable SSD 1TB', description: 'External USB 3.2 solid-state drive with compact metal enclosure.', category: 'Electronics', price: 6999.0, stock: 14, status: 'active' },
  { id: 'prod_0007', sku: 'SKU-ELE-007', name: '27-inch IPS Monitor', description: '27-inch QHD IPS monitor with adjustable tilt stand.', category: 'Electronics', price: 15999.0, stock: 8, status: 'active' },
  { id: 'prod_0008', sku: 'SKU-ELE-008', name: 'Laptop Stand', description: 'Aluminium adjustable laptop stand with anti-slip pads.', category: 'Electronics', price: 1299.0, stock: 56, status: 'active' },
  { id: 'prod_0009', sku: 'SKU-ELE-009', name: 'USB-C Charger 65W', description: 'Compact 65W USB-C PD wall charger.', category: 'Electronics', price: 1799.0, stock: 63, status: 'active' },
  { id: 'prod_0010', sku: 'SKU-ELE-010', name: 'Smart LED Bulb', description: 'Wi-Fi dimmable LED bulb with warm and cool white modes.', category: 'Electronics', price: 599.0, stock: 0, status: 'inactive' },
  { id: 'prod_0011', sku: 'SKU-OFF-001', name: 'A5 Hardcover Notebook', description: '160-page ruled notebook with durable hardcover.', category: 'Office', price: 249.0, stock: 120, status: 'active' },
  { id: 'prod_0012', sku: 'SKU-OFF-002', name: 'Gel Pen Set', description: 'Pack of five 0.5 mm quick-drying gel pens.', category: 'Office', price: 149.0, stock: 200, status: 'active' },
  { id: 'prod_0013', sku: 'SKU-OFF-003', name: 'Desk Organizer', description: 'Multi-compartment desktop stationery organizer.', category: 'Office', price: 499.0, stock: 45, status: 'active' },
  { id: 'prod_0014', sku: 'SKU-OFF-004', name: 'A4 Printer Paper', description: '500-sheet ream of 75 GSM multipurpose paper.', category: 'Office', price: 329.0, stock: 76, status: 'active' },
  { id: 'prod_0015', sku: 'SKU-OFF-005', name: 'Ergonomic Office Chair', description: 'Adjustable office chair with lumbar support and mesh back.', category: 'Office', price: 8999.0, stock: 11, status: 'active' },
  { id: 'prod_0016', sku: 'SKU-HOM-001', name: 'Stainless Steel Bottle', description: '750 ml insulated stainless steel water bottle.', category: 'Home', price: 699.0, stock: 91, status: 'active' },
  { id: 'prod_0017', sku: 'SKU-HOM-002', name: 'Ceramic Coffee Mug', description: '350 ml glazed ceramic everyday mug.', category: 'Home', price: 299.0, stock: 68, status: 'active' },
  { id: 'prod_0018', sku: 'SKU-HOM-003', name: 'Cotton Bedsheet Set', description: 'Queen-size cotton bedsheet set with two pillow covers.', category: 'Home', price: 1499.0, stock: 24, status: 'active' },
  { id: 'prod_0019', sku: 'SKU-HOM-004', name: 'LED Desk Lamp', description: 'Adjustable LED desk lamp with three brightness levels.', category: 'Home', price: 1099.0, stock: 37, status: 'active' },
  { id: 'prod_0020', sku: 'SKU-HOM-005', name: 'Storage Basket', description: 'Woven multipurpose basket with reinforced handles.', category: 'Home', price: 449.0, stock: 0, status: 'inactive' },
  { id: 'prod_0021', sku: 'SKU-FIT-001', name: 'Yoga Mat', description: '6 mm non-slip exercise mat with carrying strap.', category: 'Fitness', price: 899.0, stock: 52, status: 'active' },
  { id: 'prod_0022', sku: 'SKU-FIT-002', name: 'Resistance Band Set', description: 'Set of five resistance bands with different tension levels.', category: 'Fitness', price: 549.0, stock: 73, status: 'active' },
  { id: 'prod_0023', sku: 'SKU-FIT-003', name: 'Stainless Steel Shaker', description: '700 ml leak-resistant shaker bottle with mixing insert.', category: 'Fitness', price: 399.0, stock: 88, status: 'active' },
  { id: 'prod_0024', sku: 'SKU-FIT-004', name: 'Adjustable Dumbbell', description: 'Single adjustable dumbbell with compact weight selector.', category: 'Fitness', price: 4999.0, stock: 6, status: 'active' },
  { id: 'prod_0025', sku: 'SKU-BAG-001', name: 'Everyday Backpack', description: '20-litre water-resistant backpack with padded laptop sleeve.', category: 'Accessories', price: 1799.0, stock: 29, status: 'active' },
  { id: 'prod_0026', sku: 'SKU-BAG-002', name: 'Laptop Sleeve 15-inch', description: 'Padded sleeve with soft lining for laptops up to 15 inches.', category: 'Accessories', price: 799.0, stock: 44, status: 'active' },
  { id: 'prod_0027', sku: 'SKU-BAG-003', name: 'Travel Organizer Pouch', description: 'Zippered pouch for cables, adapters and small devices.', category: 'Accessories', price: 499.0, stock: 61, status: 'active' },
  { id: 'prod_0028', sku: 'SKU-BAG-004', name: 'Polarized Sunglasses', description: 'Lightweight polarized sunglasses with UV400 protection.', category: 'Accessories', price: 1299.0, stock: 17, status: 'active' },
  { id: 'prod_0029', sku: 'SKU-KIT-001', name: 'Chef Knife 8-inch', description: 'Stainless steel chef knife with balanced handle.', category: 'Kitchen', price: 999.0, stock: 21, status: 'active' },
  { id: 'prod_0030', sku: 'SKU-KIT-002', name: 'Glass Food Container Set', description: 'Set of three borosilicate glass food storage containers.', category: 'Kitchen', price: 1199.0, stock: 34, status: 'active' },
  { id: 'prod_0031', sku: 'FTX-0031', name: 'Managed Gigabit Switch 8-Port', description: 'Compact managed Ethernet switch with VLAN and QoS support.', category: 'Networking', price: 4596.75, stock: 40, status: 'active' },
  { id: 'prod_0032', sku: 'FTX-0032', name: 'Wi-Fi 6 Access Point', description: 'Dual-band wireless access point for small office networks.', category: 'Networking', price: 4733.0, stock: 53, status: 'active' },
  { id: 'prod_0033', sku: 'FTX-0033', name: 'USB-C 2.5GbE Adapter', description: 'USB-C to 2.5 Gigabit Ethernet adapter for workstation connectivity.', category: 'Networking', price: 4870.25, stock: 66, status: 'active' },
  { id: 'prod_0034', sku: 'FTX-0034', name: 'Cat6 Patch Cable 2m', description: 'Shielded Category 6 patch cable for structured network setups.', category: 'Networking', price: 5007.5, stock: 79, status: 'active' },
  { id: 'prod_0035', sku: 'FTX-0035', name: 'Hardware Security Key', description: 'FIDO2-compatible security key for phishing-resistant authentication.', category: 'Cybersecurity', price: 5144.75, stock: 92, status: 'active' },
  { id: 'prod_0036', sku: 'FTX-0036', name: 'Encrypted USB Drive 64GB', description: 'Portable encrypted storage for controlled data transfer.', category: 'Cybersecurity', price: 5281.0, stock: 105, status: 'active' },
  { id: 'prod_0037', sku: 'FTX-0037', name: 'Network Security Appliance', description: 'Compact appliance for lab firewall and gateway evaluation.', category: 'Cybersecurity', price: 5418.25, stock: 118, status: 'active' },
  { id: 'prod_0038', sku: 'FTX-0038', name: 'Smart Card Reader', description: 'USB smart-card reader for certificate-based authentication labs.', category: 'Cybersecurity', price: 5555.5, stock: 10, status: 'active' },
  { id: 'prod_0039', sku: 'FTX-0039', name: 'USB Logic Analyzer 8-Channel', description: 'Entry-level logic analyzer for embedded debugging.', category: 'Developer Tools', price: 5692.75, stock: 23, status: 'active' },
  { id: 'prod_0040', sku: 'FTX-0040', name: 'USB-C Development Hub', description: 'Powered development hub with multiple data and display ports.', category: 'Developer Tools', price: 5829.0, stock: 36, status: 'active' },
  { id: 'prod_0041', sku: 'FTX-0041', name: 'ESP32 Development Board', description: 'Wi-Fi and Bluetooth development board for IoT prototyping.', category: 'Developer Tools', price: 5966.25, stock: 49, status: 'active' },
  { id: 'prod_0042', sku: 'FTX-0042', name: 'Raspberry Pi Compute Kit', description: 'Single-board computing kit for edge and automation projects.', category: 'Developer Tools', price: 6103.5, stock: 62, status: 'active' },
  { id: 'prod_0043', sku: 'FTX-0043', name: 'Portable SSD 1TB', description: 'High-speed external solid-state drive for project backups.', category: 'Cloud & Storage', price: 6240.75, stock: 75, status: 'active' },
  { id: 'prod_0044', sku: 'FTX-0044', name: 'NAS Drive 4TB', description: 'Network-attached storage drive for shared lab data.', category: 'Cloud & Storage', price: 6377.0, stock: 88, status: 'inactive' },
  { id: 'prod_0045', sku: 'FTX-0045', name: 'USB Backup Drive 2TB', description: 'Portable drive for offline backup and restore exercises.', category: 'Cloud & Storage', price: 6514.25, stock: 101, status: 'active' },
  { id: 'prod_0046', sku: 'FTX-0046', name: 'NVMe SSD 2TB', description: 'M.2 NVMe solid-state drive for workstation storage.', category: 'Cloud & Storage', price: 6651.5, stock: 114, status: 'active' },
  { id: 'prod_0047', sku: 'FTX-0047', name: 'Smart Plug with Energy Meter', description: 'Connected plug with power monitoring for lab devices.', category: 'Smart Devices', price: 6788.75, stock: 6, status: 'active' },
  { id: 'prod_0048', sku: 'FTX-0048', name: 'Environmental Sensor Hub', description: 'Connected hub for temperature and humidity telemetry.', category: 'Smart Devices', price: 6925.0, stock: 19, status: 'active' },
  { id: 'prod_0049', sku: 'FTX-0049', name: 'Smart LED Controller', description: 'Network-enabled controller for addressable LED installations.', category: 'Smart Devices', price: 7062.25, stock: 32, status: 'active' },
  { id: 'prod_0050', sku: 'FTX-0050', name: 'Bluetooth Tracker Tag', description: 'Compact tracker tag for asset-location demonstrations.', category: 'Smart Devices', price: 7199.5, stock: 45, status: 'active' },
  { id: 'prod_0051', sku: 'FTX-0051', name: '1080p USB Webcam', description: 'USB webcam with autofocus for remote collaboration.', category: 'Audio & Video', price: 7336.75, stock: 58, status: 'active' },
  { id: 'prod_0052', sku: 'FTX-0052', name: 'USB Conference Speakerphone', description: 'Compact speakerphone with echo cancellation.', category: 'Audio & Video', price: 7473.0, stock: 71, status: 'active' },
  { id: 'prod_0053', sku: 'FTX-0053', name: 'Portable HDMI Capture Card', description: 'HDMI-to-USB capture device for video input workflows.', category: 'Audio & Video', price: 7610.25, stock: 84, status: 'active' },
  { id: 'prod_0054', sku: 'FTX-0054', name: 'Noise-Isolating Headset', description: 'Wired headset with microphone for development workstations.', category: 'Audio & Video', price: 7747.5, stock: 97, status: 'active' },
  { id: 'prod_0055', sku: 'FTX-0055', name: 'Mechanical Keyboard', description: 'Tenkeyless mechanical keyboard for daily workstation use.', category: 'Computer Peripherals', price: 7884.75, stock: 110, status: 'active' },
  { id: 'prod_0056', sku: 'FTX-0056', name: 'Ergonomic Wireless Mouse', description: 'Wireless mouse with adjustable DPI and ergonomic profile.', category: 'Computer Peripherals', price: 8021.0, stock: 2, status: 'active' },
  { id: 'prod_0057', sku: 'FTX-0057', name: '27-inch IPS Monitor', description: 'QHD IPS monitor for productivity and development.', category: 'Computer Peripherals', price: 8158.25, stock: 15, status: 'active' },
  { id: 'prod_0058', sku: 'FTX-0058', name: 'USB-C Docking Station', description: 'Dock with display, Ethernet and peripheral connectivity.', category: 'Computer Peripherals', price: 8295.5, stock: 28, status: 'active' },
  { id: 'prod_0059', sku: 'FTX-0059', name: '650VA Line-Interactive UPS', description: 'Compact UPS for workstation power continuity.', category: 'Power & Backup', price: 8432.75, stock: 41, status: 'active' },
  { id: 'prod_0060', sku: 'FTX-0060', name: '1000VA Line-Interactive UPS', description: 'Higher-capacity UPS for small lab equipment.', category: 'Power & Backup', price: 8569.0, stock: 54, status: 'active' },
  { id: 'prod_0061', sku: 'FTX-0061', name: '65W USB-C GaN Charger', description: 'Compact USB-C power adapter with Power Delivery.', category: 'Power & Backup', price: 8706.25, stock: 67, status: 'active' },
  { id: 'prod_0062', sku: 'FTX-0062', name: 'Surge Protection Strip', description: 'Multi-outlet surge protector for desk equipment.', category: 'Power & Backup', price: 8843.5, stock: 80, status: 'active' },
  { id: 'prod_0063', sku: 'FTX-0063', name: 'DIN-Rail IoT Gateway', description: 'Industrial edge gateway for protocol translation and telemetry.', category: 'Industrial IoT', price: 8980.75, stock: 93, status: 'active' },
  { id: 'prod_0064', sku: 'FTX-0064', name: 'Modbus RTU Converter', description: 'Serial-to-Ethernet converter for industrial integration labs.', category: 'Industrial IoT', price: 9117.0, stock: 106, status: 'active' },
  { id: 'prod_0065', sku: 'FTX-0065', name: 'Industrial Ethernet Switch', description: 'Rugged unmanaged switch for industrial network setups.', category: 'Industrial IoT', price: 9254.25, stock: 119, status: 'active' },
  { id: 'prod_0066', sku: 'FTX-0066', name: '24V DC Power Supply', description: 'DIN-rail power supply for control and sensor systems.', category: 'Industrial IoT', price: 9391.5, stock: 11, status: 'active' },
  { id: 'prod_0067', sku: 'FTX-0067', name: 'Temperature Probe Kit', description: 'Digital temperature probes for environmental monitoring.', category: 'Monitoring & Sensors', price: 9528.75, stock: 24, status: 'inactive' },
  { id: 'prod_0068', sku: 'FTX-0068', name: 'Air Quality Sensor', description: 'Sensor module for particulate and air-quality measurements.', category: 'Monitoring & Sensors', price: 9665.0, stock: 37, status: 'active' },
  { id: 'prod_0069', sku: 'FTX-0069', name: 'Current Clamp Sensor', description: 'Non-invasive current sensor for equipment monitoring.', category: 'Monitoring & Sensors', price: 9802.25, stock: 50, status: 'active' },
  { id: 'prod_0070', sku: 'FTX-0070', name: 'Vibration Sensor Module', description: 'Sensor module for condition-monitoring prototypes.', category: 'Monitoring & Sensors', price: 9939.5, stock: 63, status: 'active' },
  { id: 'prod_0071', sku: 'FTX-0071', name: 'Digital Multimeter', description: 'Handheld digital multimeter for electronics lab measurements.', category: 'Lab Equipment', price: 10076.75, stock: 76, status: 'active' },
  { id: 'prod_0072', sku: 'FTX-0072', name: 'Adjustable Bench Power Supply', description: 'Regulated DC bench supply for prototyping.', category: 'Lab Equipment', price: 10213.0, stock: 89, status: 'active' },
  { id: 'prod_0073', sku: 'FTX-0073', name: 'Soldering Station', description: 'Temperature-controlled soldering station for electronics work.', category: 'Lab Equipment', price: 10350.25, stock: 102, status: 'active' },
  { id: 'prod_0074', sku: 'FTX-0074', name: 'Breadboard Prototyping Kit', description: 'Breadboards and jumper wires for circuit prototyping.', category: 'Lab Equipment', price: 10487.5, stock: 115, status: 'active' },
  { id: 'prod_0075', sku: 'FTX-0075', name: 'Biometric Access Reader', description: 'Access-control reader for lab identity demonstrations.', category: 'Safety & Security', price: 10624.75, stock: 7, status: 'active' },
  { id: 'prod_0076', sku: 'FTX-0076', name: 'Smart Door Contact Sensor', description: 'Magnetic contact sensor for door-state monitoring.', category: 'Safety & Security', price: 10761.0, stock: 20, status: 'active' },
  { id: 'prod_0077', sku: 'FTX-0077', name: 'IP Security Camera', description: 'Network camera for controlled video-surveillance lab setups.', category: 'Safety & Security', price: 10898.25, stock: 33, status: 'active' },
  { id: 'prod_0078', sku: 'FTX-0078', name: 'Electronic Cabinet Lock', description: 'Electronic lock module for equipment cabinet access.', category: 'Safety & Security', price: 11035.5, stock: 46, status: 'active' },
  { id: 'prod_0079', sku: 'FTX-0079', name: 'Barcode Scanner', description: 'USB barcode scanner for inventory workflows.', category: 'Packaging & Logistics', price: 11172.75, stock: 59, status: 'active' },
  { id: 'prod_0080', sku: 'FTX-0080', name: 'Thermal Label Printer', description: 'Desktop thermal printer for shipping and asset labels.', category: 'Packaging & Logistics', price: 11309.0, stock: 72, status: 'active' },
  { id: 'prod_0081', sku: 'FTX-0081', name: 'RFID Reader Kit', description: 'RFID reader and tags for asset-tracking prototypes.', category: 'Packaging & Logistics', price: 11446.25, stock: 85, status: 'active' },
  { id: 'prod_0082', sku: 'FTX-0082', name: 'Digital Shipping Scale', description: 'Compact digital scale for package-weight capture.', category: 'Packaging & Logistics', price: 11583.5, stock: 98, status: 'active' },
  { id: 'prod_0083', sku: 'FTX-0083', name: 'OBD-II Diagnostic Adapter', description: 'Diagnostic adapter for vehicle telemetry demonstrations.', category: 'Automotive', price: 11720.75, stock: 111, status: 'active' },
  { id: 'prod_0084', sku: 'FTX-0084', name: '12V Battery Tester', description: 'Battery health tester for automotive maintenance labs.', category: 'Automotive', price: 11857.0, stock: 3, status: 'active' },
  { id: 'prod_0085', sku: 'FTX-0085', name: 'Portable Tyre Inflator', description: 'Compact inflator with digital pressure display.', category: 'Automotive', price: 11994.25, stock: 16, status: 'active' },
  { id: 'prod_0086', sku: 'FTX-0086', name: 'Dash Camera 1080p', description: 'Full-HD dash camera for vehicle recording.', category: 'Automotive', price: 12131.5, stock: 29, status: 'active' },
  { id: 'prod_0087', sku: 'FTX-0087', name: 'Digital Blood Pressure Monitor', description: 'Home-use digital blood pressure monitor.', category: 'Personal Care', price: 12268.75, stock: 42, status: 'active' },
  { id: 'prod_0088', sku: 'FTX-0088', name: 'Infrared Thermometer', description: 'Non-contact thermometer for temperature measurement.', category: 'Personal Care', price: 12405.0, stock: 55, status: 'active' },
  { id: 'prod_0089', sku: 'FTX-0089', name: 'Electric Grooming Trimmer', description: 'Rechargeable personal grooming trimmer.', category: 'Personal Care', price: 12542.25, stock: 68, status: 'active' },
  { id: 'prod_0090', sku: 'FTX-0090', name: 'Digital Body Scale', description: 'Digital scale with basic weight measurement.', category: 'Personal Care', price: 12679.5, stock: 81, status: 'active' },
  { id: 'prod_0091', sku: 'FTX-0091', name: 'Rugged Power Bank 20000mAh', description: 'High-capacity portable battery for travel and field work.', category: 'Outdoor & Travel', price: 12816.75, stock: 94, status: 'active' },
  { id: 'prod_0092', sku: 'FTX-0092', name: 'Solar Charging Panel 20W', description: 'Portable solar panel for small-device charging.', category: 'Outdoor & Travel', price: 12953.0, stock: 107, status: 'inactive' },
  { id: 'prod_0093', sku: 'FTX-0093', name: 'GPS Handheld Receiver', description: 'Portable GPS receiver for outdoor navigation.', category: 'Outdoor & Travel', price: 13090.25, stock: 120, status: 'active' },
  { id: 'prod_0094', sku: 'FTX-0094', name: 'Weatherproof Equipment Case', description: 'Protective case for transporting sensitive equipment.', category: 'Outdoor & Travel', price: 13227.5, stock: 12, status: 'active' },
  { id: 'prod_0095', sku: 'FTX-0095', name: 'Arduino Sensor Starter Kit', description: 'Microcontroller starter kit with common sensors.', category: 'Learning & STEM', price: 13364.75, stock: 25, status: 'active' },
  { id: 'prod_0096', sku: 'FTX-0096', name: 'Robotics Chassis Kit', description: 'Mobile robotics chassis with motors and mounting hardware.', category: 'Learning & STEM', price: 13501.0, stock: 38, status: 'active' },
  { id: 'prod_0097', sku: 'FTX-0097', name: 'FPGA Learning Board', description: 'Entry-level FPGA board for digital design education.', category: 'Learning & STEM', price: 13638.25, stock: 51, status: 'active' },
  { id: 'prod_0098', sku: 'FTX-0098', name: '3D Printing Filament 1kg', description: 'PLA filament spool for educational prototyping.', category: 'Learning & STEM', price: 13775.5, stock: 64, status: 'inactive' },
  { id: 'prod_0099', sku: 'FTX-0099', name: 'API Testing Tool License', description: 'One-year license for API testing and collaboration workflows.', category: 'Software & Licenses', price: 13912.75, stock: 77, status: 'active' },
  { id: 'prod_0100', sku: 'FTX-0100', name: 'Developer IDE License', description: 'One-year developer IDE subscription for an individual user.', category: 'Software & Licenses', price: 14049.0, stock: 90, status: 'active' },
];

const CUSTOMER_NAMES = [
  'Aarav Mehta', 'Priya Nair', 'Rohan Kulkarni', 'Ananya Iyer', 'Vikram Rao',
  'Neha Deshmukh', 'Karan Malhotra', 'Divya Menon', 'Siddharth Joshi', 'Meera Sharma',
  'Arjun Verma', 'Kavya Chatterjee', 'Nikhil Bansal', 'Ishita Gupta', 'Pranav Reddy',
  'Ritika Kapoor', 'Aditya Sinha', 'Pooja Bhatia', 'Manish Tiwari', 'SnehaPatel',
];

export function buildCanonicalCustomersSeed(count = 20): Array<{ recordId: string; data: Record<string, unknown> }> {
  const safeCount = Math.min(Math.max(1, count), 50);
  const tiers = ['standard', 'pro', 'enterprise'] as const;
  const rows: Array<{ recordId: string; data: Record<string, unknown> }> = [];
  for (let i = 1; i <= safeCount; i++) {
    const padded = String(i).padStart(4, '0');
    const baseName = CUSTOMER_NAMES[(i - 1) % CUSTOMER_NAMES.length].replace('SnehaPatel', 'Sneha Patel');
    const handle = baseName.toLowerCase().replace(/[^a-z]+/g, '.');
    rows.push({
      recordId: `cust_${padded}`,
      data: {
        name: baseName,
        email: `${handle}.${padded}@example-store.in`,
        tier: tiers[(i - 1) % tiers.length],
        status: i % 10 === 0 ? 'suspended' : 'active',
      },
    });
  }
  return rows;
}

export function buildCanonicalOrdersSeed(count = 20): Array<{ recordId: string; data: Record<string, unknown> }> {
  const safeCount = Math.min(Math.max(1, count), 100);
  const statuses = ['paid', 'shipped', 'pending', 'paid', 'cancelled'] as const;
  const rows: Array<{ recordId: string; data: Record<string, unknown> }> = [];
  for (let i = 1; i <= safeCount; i++) {
    const padded = String(i).padStart(4, '0');
    const prod = FTX_STUDIO_PRODUCTS_SEED[(i - 1) % FTX_STUDIO_PRODUCTS_SEED.length];
    const qty = ((i - 1) % 4) + 1;
    rows.push({
      recordId: `ord_${padded}`,
      data: {
        customerId: `cust_${String(((i - 1) % 20) + 1).padStart(4, '0')}`,
        productId: prod.id,
        quantity: qty,
        total: Number((prod.price * qty).toFixed(2)),
        status: statuses[(i - 1) % statuses.length],
      },
    });
  }
  return rows;
}

export function generateDeterministicRecordsForSchema(
  slug: string,
  fields: StudioFieldDefinition[],
  count: number,
  startIndex = 1
): Array<{ recordId: string; data: Record<string, unknown> }> {
  const safeCount = Math.min(Math.max(1, count), 100);

  // Use canonical 100-product seed when seeding a compatible Products resource from index 1
  const fieldNames = new Set(fields.map((f) => f.name));
  const isProductsCanonical =
    slug === 'products' &&
    startIndex === 1 &&
    ['sku', 'name', 'category', 'price', 'stock', 'status'].every((k) => fieldNames.has(k));

  if (isProductsCanonical) {
    return FTX_STUDIO_PRODUCTS_SEED.slice(0, safeCount).map((p) => {
      const data: Record<string, unknown> = {};
      for (const f of fields) {
        if (Object.prototype.hasOwnProperty.call(p, f.name)) {
          data[f.name] = (p as unknown as Record<string, unknown>)[f.name];
        } else if (f.required) {
          data[f.name] = defaultFieldValue(f, 1, slug);
        }
      }
      return { recordId: p.id, data };
    });
  }

  if (slug === 'customers' && startIndex === 1 && ['name', 'email', 'tier', 'status'].every((k) => fieldNames.has(k))) {
    return buildCanonicalCustomersSeed(safeCount);
  }

  if (
    slug === 'orders' &&
    startIndex === 1 &&
    ['customerId', 'productId', 'quantity', 'total', 'status'].every((k) => fieldNames.has(k))
  ) {
    return buildCanonicalOrdersSeed(safeCount);
  }

  const prefix = slug.replace(/[^a-z0-9]/g, '').slice(0, 4) || 'item';
  const records: Array<{ recordId: string; data: Record<string, unknown> }> = [];
  for (let offset = 0; offset < safeCount; offset++) {
    const idx = startIndex + offset;
    const recordId = `${prefix}_${String(idx).padStart(4, '0')}`;
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      data[f.name] = defaultFieldValue(f, idx, slug);
    }
    records.push({ recordId, data });
  }
  return records;
}

function defaultFieldValue(field: StudioFieldDefinition, index: number, slug: string): unknown {
  const padded = String(index).padStart(4, '0');
  switch (field.type) {
    case 'enum': {
      const vals = field.enumValues && field.enumValues.length > 0 ? field.enumValues : ['active'];
      return vals[(index - 1) % vals.length];
    }
    case 'boolean':
      return index % 5 !== 0;
    case 'integer': {
      const min = typeof field.min === 'number' ? Math.ceil(field.min) : 1;
      const max = typeof field.max === 'number' ? Math.floor(field.max) : Math.max(min + 100, 100);
      const span = Math.max(1, max - min + 1);
      return min + ((index * 13) % span);
    }
    case 'number': {
      const min = typeof field.min === 'number' ? field.min : 100;
      const max = typeof field.max === 'number' ? field.max : Math.max(min + 5000, 5000);
      const raw = min + ((index * 137.25) % Math.max(1, max - min));
      return Number(raw.toFixed(2));
    }
    case 'string':
    default: {
      const lower = field.name.toLowerCase();
      if (lower === 'sku' || lower.endsWith('code')) {
        return `FTX-${slug.slice(0, 3).toUpperCase()}-${padded}`;
      }
      if (lower.includes('email')) {
        return `user.${padded}@example.fortix.local`;
      }
      if (lower === 'category') {
        return FTX_STUDIO_PRODUCTS_CATEGORIES[(index - 1) % FTX_STUDIO_PRODUCTS_CATEGORIES.length];
      }
      const val = `${slug.charAt(0).toUpperCase() + slug.slice(1)} ${field.name} ${padded}`;
      return field.maxLength ? val.slice(0, field.maxLength) : val;
    }
  }
}
