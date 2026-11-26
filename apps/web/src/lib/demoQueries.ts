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
    title: "Express buses stopping at next stop instead of GH stop",
    question:
      "Why are express buses stopping at the next stop instead of the GH stop?",
    category: "transport",
    locationText: "GH Bus Stop, Main Road",
    sampleCompleteReply:
      "Express buses were stopping at the next stop due to temporary road work near the GH stop. The work is now cleared, and express buses will stop at the GH stop from tomorrow."
  },
  {
    id: "construction_site",
    label: "Construction Site (Video)",
    title: "Open road pit near school gate without barriers",
    question:
      "There is an open drainage pit near Govt High School Gate 2 with no safety barriers. When will barriers be placed?",
    category: "construction",
    locationText: "Govt High School Gate 2, Ward 14",
    sampleCompleteReply:
      "Safety barriers and warning cones were installed around the pit near Gate 2 today, and the concrete cover will be placed by Friday."
  },
  {
    id: "hostel_water",
    label: "Hostel Water Outage",
    title: "No drinking water in Hostel Block C",
    question:
      "There has been no drinking water in Hostel Block C for 3 days. What caused it and when will water return?",
    category: "water",
    locationText: "Hostel Block C, 2nd Floor",
    sampleCompleteReply:
      "A damaged pipe valve on the 2nd floor tank line caused the outage. The valve was replaced today at 10:30 AM and drinking water is now restored."
  },
  {
    id: "streetlights",
    label: "Streetlights Out",
    title: "Streetlights not working on 4th Cross Street",
    question:
      "Six streetlights on 4th Cross Street have been off for a week. When will they be repaired?",
    category: "roads",
    locationText: "4th Cross Street, Anna Nagar",
    sampleCompleteReply:
      "A faulty power relay on Pole 16 was replaced today, and all six streetlights on 4th Cross Street are working again."
  },
  {
    id: "rti_compensation",
    label: "RTI File Status",
    title: "Status of road widening compensation file",
    question:
      "What is the current status of my road widening compensation application for Survey No. 112/4, and when will it be paid?",
    category: "rti",
    locationText: "Taluk Office, Ward 18",
    sampleCompleteReply:
      "Your compensation application for Survey No. 112/4 is approved, and the payment has been scheduled for bank transfer this Friday."
  }
];
