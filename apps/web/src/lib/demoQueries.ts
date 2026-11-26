export interface DemoQueryPreset {
  id: string;
  label: string;
  title: string;
  question: string;
  category: string;
  locationText: string;
  sampleCompleteReply: string;
}

export const DEMO_TEST_QUERIES: DemoQueryPreset[] = [
  {
    id: "bus_stop",
    label: "Bus Skipping Stop",
    title: "Express buses skipping GH stop during morning peak",
    question:
      "Route 21G and 47A express buses have been skipping the Government Hospital bus stop between 8:00 AM and 9:30 AM on weekdays. Please issue a circular enforcing mandatory halts and share the circular number and inspection schedule.",
    category: "transport",
    locationText: "GH Bus Stop, Main Road",
    sampleCompleteReply:
      "Depot Circular MTC/SLM/OPS/2026-114 issued on 26 Nov 2026 mandates 2-minute halts for Routes 21G and 47A at GH Bus Stop during 8:00 AM - 9:30 AM. Traffic Inspectors will run checks every Mon/Wed/Fri morning for 4 weeks."
  },
  {
    id: "hostel_water",
    label: "Hostel Water Outage",
    title: "No drinking water supply in Hostel Block C for 4 days",
    question:
      "The RO water purifier and overhead tank line in Hostel Block C (2nd and 3rd floors) have had zero water supply since 22 November. Please share the maintenance work order number, technician inspection date, and confirm when water supply is restored.",
    category: "water",
    locationText: "Hostel Block C, 2nd Floor",
    sampleCompleteReply:
      "Work Order #WO-2026-884 executed on 26 Nov 2026. Plumber team inspected Hostel Block C 2nd floor tank line and replaced the faulty solenoid valve at 10:30 AM; full water pressure verified across all taps."
  },
  {
    id: "streetlights",
    label: "Streetlights Out",
    title: "6 LED streetlights out on 4th Cross Street",
    question:
      "All 6 LED streetlights between Plot 14 and the corner junction on 4th Cross Street have been non-functional since 12 November. Previous tickets were closed without inspection. Please provide the repair job ID and restore lighting.",
    category: "roads",
    locationText: "4th Cross Street, Anna Nagar",
    sampleCompleteReply:
      "Electrical Maintenance Job #EM-2026-419 completed on 26 Nov 2026. Damaged feeder relay at Pole #16 replaced and all 6 LED luminaires tested operational at 6:15 PM."
  },
  {
    id: "rti_compensation",
    label: "RTI File Status",
    title: "Status of road widening compensation for Survey No. 112/4",
    question:
      "Under RTI, please provide the current status of the land acquisition compensation file for Survey No. 112/4 submitted on 14 Aug 2026, the exact date the disbursement order was signed, and the payment reference number.",
    category: "rti",
    locationText: "Taluk Office, Ward 18",
    sampleCompleteReply:
      "File Ref #LAQ/W18/2026-1124 approved on 20 Nov 2026. Disbursement Order signed by Special Tahsildar on 21 Nov 2026 and NEFT Ref #UTR9920148812 credited on 24 Nov 2026."
  }
];
