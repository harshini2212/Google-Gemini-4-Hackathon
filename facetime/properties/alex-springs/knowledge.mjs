// Knowledge pack for 9530 Alex Springs Lane, Houston, TX 77044 (detached house for sale).
// Hand-built from local data only:
//   CoStar      - kit residential-listings.jsonl (Homes.com listing 237452267, propertyId 500020417264)
//                 and residential-listing-features.jsonl (same listing id); comps and nearby
//                 properties from the same kit, distances straight-line from the listing's lat/lon
//   Matterport  - cache/matterport/ft9fdh4k36m/model.json (room polygons, areas, ceiling heights)
//   Vexcel      - cache/vexcel/parcel/29.864419_-95.191623.json (parcel analysis, 2023 imagery) and the
//                 ortho image us-tx-baytown-2026 (captured 1 Jan to 7 Feb 2026, about 7 cm)
//   Scan stills - panorama faces of model ft9fdh4k36m ("visible in scan")
// Room dimensions are the bounding box of each Matterport room outline, converted from metres.
// Two scan labels are wrong and are corrected here: "Kitchen" (542.5 sq ft) is the open
// living/dining/kitchen room; "Living Room" (367.4 sq ft) is the garage.

export const propertyBrief = `PROPERTY BRIEF: 9530 Alex Springs Lane, Houston, TX 77044. A detached house FOR SALE.
Source tags: (CoStar) = Homes.com listing record and its feature list; (Matterport) = the 3D scan's measurements; (Vexcel) = aerial image and parcel analysis; (visible in scan) = what is on camera. Say only what is listed here. Speak the rounded number; exact figures are in [brackets]. Where sources disagree, say so: "the record says, the remarks say, the scan shows".

THE HOME
- One-story detached house, 4 bedrooms, 2 full baths, 2-car attached garage, built 2006, brick front with siding, composition roof, slab foundation, central heating and cooling, no fireplace (CoStar).
- Bedrooms: the record says 4; the listing remarks say "3 bedroom"; the scan shows 4 rooms that read as bedrooms, the primary plus three (Matterport).
- Size: listed at 1,744 sq ft (CoStar). The scan measures 1,648 sq ft of floor, and that includes the 367 sq ft garage: about 1,280 sq ft of rooms [1,280.3], not counting closets the scan left unmeasured, or 1,818 sq ft with walls and garage (Matterport). Give both; suggest an appraiser's measurement.
- Condition: the remarks say it is "currently undergoing renovations". The scan, made 9 November 2026, shows empty white-walled rooms, no work in progress (visible in scan).
- Appliances: the remarks say new appliances "will be installed". The scan shows a white refrigerator, white gas range, white dishwasher and stainless microwave in place; the laundry closet has hookups but no washer or dryer (visible in scan).
- The record flags a spa; none appears in the scan or aerial. Do not promise one.

ROOM BY ROOM (areas from Matterport; dimensions are bounding boxes, approximate)
- entry: no foyer; the front door opens from the covered porch straight into the living area (visible in scan).
- living, dining, kitchen: one open room of about 540 sq ft [542.5], 9 ft ceiling (Matterport; the scan mislabels it "Kitchen"). Living area is roughly 17 by 17 ft, kitchen and dining together roughly 20 by 12 ft (approximate split). Living: wood-look plank floor (not hardwood; the record lists tile and carpet), ceiling fan, front windows, arched openings to the kitchen (visible in scan).
- kitchen: grey cabinets, white countertops, double-bowl sink with black pull-down faucet on a peninsula, pantry with shelves, tile floor (visible in scan). Record lists gas cooktop and oven, microwave, dishwasher, disposal, ice maker (CoStar).
- dining: tile floor, chandelier, window, a half-glass door to the side yard and a door to the garage (visible in scan).
- hallway: about 60 sq ft [59.8], roughly 17 by 4 ft, plus a 15 sq ft side hall; 8 ft ceiling (Matterport). Wood-look floor, thermostat, attic hatch, linen doors (visible in scan).
- laundry: a closet off the hallway with washer hookups and a shelf; not measured as a room in the scan (visible in scan).
- primary_bedroom: about 200 sq ft [201.8], roughly 14 by 16 ft, 9 ft ceiling, at the back of the house (Matterport). Carpet, ceiling fan, windows (visible in scan).
- primary_bath: about 80 sq ft [80.1], roughly 10 by 9 ft (Matterport). Double vanity with grey cabinets, corner soaking tub under a frosted window, separate glass shower, tile floor (visible in scan).
- closet: primary walk-in, about 33 sq ft [33.1], roughly 10 by 4 ft, entered from the primary bath (Matterport). Carpet, shelf and hanging rail (visible in scan).
- bedroom: three more, about 101, 102 and 96 sq ft [101.3, 102.2, 95.9], each roughly 10 by 12 ft, 8 ft ceilings (Matterport). Carpet, ceiling fan, one window, a closet each (visible in scan).
- bathroom: hall bath, about 49 sq ft [48.8], roughly 5 by 12 ft (Matterport). Single vanity, tub with shower, tile floor (visible in scan).
- garage: about 367 sq ft [367.4], roughly 20 by 19 ft, 8.4 ft ceiling (Matterport; the scan mislabels it "Living Room"). Two-car door with an opener, door into the dining area (visible in scan).

THE LOT AND EXTERIOR
- Lot: 0.11 acre [0.1056], 4,600 sq ft, back yard fenced, Sunrise Pines Sec 01 (CoStar). Parcel outline about 40 by 110 ft (Vexcel, approximate).
- Roof footprint about 2,250 sq ft [2,247], roughly half the lot; one structure; no pool, deck or solar detected (Vexcel).
- Roof: hip shape, shingle, 11 roof vents, no chimney (Vexcel). The parcel analysis, from August 2023 imagery, scored roof condition 1.0, the low end of its scale, and flagged a tarp and discoloration. The January-February 2026 aerial shows an even grey shingle roof, no tarp visible. Roof age and any replacement are not in the data.
- Aerial (Vexcel, Jan-Feb 2026): driveway at the front left to the street on the west side; a small grass back yard about 19 ft deep with fence lines; a neighbouring house a few feet to the south; an open grass strip with a footpath along the north side.
- Front (visible in scan): red brick, covered porch with a brick column, beige two-car garage door, concrete driveway with some cracking, lawn with a young tree, sidewalk; AC unit and wood fence gate on the south side.

PRICE, TAXES, DAYS ON MARKET, COMPS (CoStar listing snapshot; never a quote)
- Asking $215,000, active, listed 6 October 2026, no price change recorded. About $123 per listed sq ft.
- The days-on-market counter reads 1, counted 7 October; count from the list date instead.
- Taxes $5,911 a year (2024), about $490 a month. HOA: Sunrise Pines HOA, $30 a month ($363 fee). The feature list says "Seller Concessions Offered"; amount not given.
- Listing brokerage: J. Woodley Realty LLC.
- Comps (straight-line distances; only last list prices, sale prices are not in the data):
  - 10019 Meadow Mill Forest Ln, 0.8 mile: 4 bed, 2 bath, 1,394 sq ft, built 2015, one story; listed $218,000; sold, closed 30 October 2026 after 130 days.
  - 10035 Meadow Mill Forest Ln, 0.8 mile: 3 bed, 2.5 bath, 1,798 sq ft, built 2014, two story; listed $191,000; sold, closed 2 November 2026 after 19 days.
  - 11031 Bauer Elm St, 3.6 miles, same zip: 3 bed, 2 bath, 1,754 sq ft, built 2011; last listed $250,000 (from $295,000); sold, closed 20 August 2026 after 217 days.

LOCATION AND SCHOOLS
- Houston, Harris County, zip 77044 (CoStar).
- Schools named on the listing: Sheldon Lake Elementary, C.E. King Middle, C.E. King High (CoStar). No distances, ratings or zoning proof; verify with the district.
- Record flag: not near public transportation (CoStar).
- Nearest CoStar commercial property: Forest Park Apartments, 12635 Tidwell St, about 1.4 miles (straight-line).

NOT IN THE DATA: say "I don't have that in the record, I'll confirm with the listing agent"
- Why the owner is selling, offers received, the concession amount.
- Prior sale price or sale history; what the comps actually sold for.
- Inspection results; age of the roof, AC, water heater; foundation, plumbing, electrical condition.
- What the renovation covered, permits; whether a washer and dryer will be installed.
- Flood zone, flood history, insurance cost, utility bills, tax rate or exemptions.
- HOA rules and what dues cover; who owns the footpath strip; survey and easements.
- School ratings, crime, commute times, shops.`;

export const talkingPoints = {
  street: [
    "This is Alex Springs Lane in the Sunrise Pines subdivision, zip 77044, according to the CoStar listing.",
    "You can see a residential street of one and two story brick and siding homes, with sidewalks and street trees.",
    "The listing record flags the home as not near public transportation, so plan on driving.",
  ],
  porch: [
    "The front porch is covered, with a brick column and a concrete floor, and the front door sits right beside a window.",
    "The front of the house is red brick, and the CoStar record lists brick with siding on the rest.",
    "The house number, 9530, is on the brick next to the two-car garage door.",
  ],
  yard: [
    "The lot is about a tenth of an acre, 4,600 square feet in the CoStar record, and the back yard is listed as fenced.",
    "In the Vexcel aerial the back yard is a small grass area, roughly 19 feet deep behind the house.",
    "Along the south side you can see the AC unit and a wood fence gate, and the dining room door opens onto that side yard.",
  ],
  entry: [
    "There is no separate foyer, so the front door opens from the porch straight into the living area.",
    "From here the kitchen and dining are through the arched openings, and the bedroom hallway is off the living area.",
  ],
  living: [
    "The living, dining and kitchen space is one open room of about 540 square feet with a 9 foot ceiling in the Matterport scan.",
    "The living area itself is roughly 17 by 17 feet, with a ceiling fan and windows facing the front.",
    "The floor in here is a wood-look plank; the listing record only names tile and carpet, so I would not call it hardwood.",
  ],
  dining: [
    "The dining area sits beside the kitchen on a tile floor, under a chandelier, with a window for daylight.",
    "The half-glass door here leads out to the side yard, and the other door goes into the garage.",
    "Kitchen and dining together measure roughly 20 by 12 feet in the scan.",
  ],
  kitchen: [
    "The kitchen has grey cabinets, white countertops and a peninsula with a double-bowl sink and a black pull-down faucet.",
    "The listing remarks say new appliances will be installed, and the scan already shows a refrigerator, gas range, dishwasher and microwave in place.",
    "The record lists a gas cooktop and oven, a disposal and an ice maker, and there is a pantry with shelves beside the refrigerator.",
  ],
  hallway: [
    "The bedroom hallway is about 17 feet long and 4 feet wide in the scan, with an 8 foot ceiling.",
    "You can see the thermostat, the attic hatch and linen closet doors along it.",
    "Three bedrooms, the hall bath and the laundry closet open off this hall, and the primary suite is at the far end.",
  ],
  primary_bedroom: [
    "The primary bedroom is about 200 square feet in the Matterport scan, roughly 14 by 16 feet, with a 9 foot ceiling.",
    "It sits at the back of the house, carpeted, with a ceiling fan and windows.",
    "Its bathroom and walk-in closet connect directly from the room.",
  ],
  bedroom: [
    "There are three more bedrooms of about 101, 102 and 96 square feet, each roughly 10 by 12 feet with 8 foot ceilings.",
    "Each one has carpet, a ceiling fan with a light, one window and its own closet.",
    "The record says four bedrooms and the listing remarks say three; the scan shows four rooms that read as bedrooms.",
  ],
  primary_bath: [
    "The primary bath is about 80 square feet in the scan, roughly 10 by 9 feet.",
    "It has a double vanity with grey cabinets, a corner soaking tub under a frosted window and a separate glass shower.",
    "The walk-in closet is entered from this bathroom.",
  ],
  bathroom: [
    "The hall bath is the second of two full baths in the record, about 49 square feet in the scan.",
    "It has a single vanity and a tub with a shower, on a tile floor.",
  ],
  closet: [
    "The primary walk-in closet is about 33 square feet in the scan, roughly 10 by 4 feet, with a shelf and hanging rail.",
    "The other three bedrooms each have a closet, though the scan did not measure those.",
  ],
  laundry: [
    "The laundry is a closet off the bedroom hallway, with washer hookups and a shelf.",
    "There is no washer or dryer in the scan; the listing remarks say they will be installed, so I'll confirm that with the listing agent.",
  ],
  garage: [
    "The garage is attached and listed for two cars, and the scan measures it at about 367 square feet, roughly 20 by 19 feet.",
    "You can see the two-car door with an opener, and a door that leads straight into the dining area.",
    "One note: the scan's 1,648 square foot total includes this garage, so the rooms themselves measure about 1,280.",
  ],
  outside: [
    "This is the Vexcel aerial, captured between January and February 2026.",
    "The parcel is about 40 feet wide and 110 feet deep, and the house covers roughly half of it, with the driveway at the front running to the street.",
    "The roof is a shingle hip roof with no pool, deck or solar detected on the lot.",
    "Vexcel's 2023 analysis flagged a tarp and discoloration on the roof, and this newer image shows an even shingle roof with no tarp, so I'd ask the listing agent about roof work.",
  ],
  floorplan: [
    "It is a one-story plan with four bedrooms and two full baths, built in 2006, per the CoStar listing.",
    "The garage and porch are at the street end, the open living, dining and kitchen room is in the middle, and the primary suite is at the back.",
    "The listing says 1,744 square feet; the scan measures about 1,280 square feet of rooms plus a 367 square foot garage, so I'd have an appraiser confirm the size.",
    "Asking price is 215,000 dollars in the listing snapshot, with taxes of 5,911 dollars a year and HOA dues of 30 dollars a month.",
  ],
};

export const demoQuestions = [
  {
    q: "How much is it, and how long has it been on the market?",
    a: "The asking price is $215,000 in the listing snapshot, listed on October 6, 2026, with no price change recorded. The snapshot's days-on-market counter only reads 1 because it was counted on October 7, so count from the list date.",
    source: "CoStar residential listing 237452267 (currentPrice, originalPrice, listDate, dom, domDate)",
  },
  {
    q: "Is it three bedrooms or four?",
    a: "The listing record says 4 bedrooms and 2 full baths; the written remarks say 3 bedroom. The Matterport scan shows four rooms that read as bedrooms: the primary at about 200 square feet and three more of about 101, 102 and 96.",
    source: "CoStar listing (bedsMin 4, remarks); Matterport model ft9fdh4k36m (four Bedroom rooms)",
  },
  {
    q: "How big is the house really?",
    a: "The listing says 1,744 square feet. The scan measures 1,648 square feet of floor including the 367 square foot garage, which is about 1,280 square feet of rooms, or 1,818 with walls and garage. I can't reconcile those, so I'd have an appraiser confirm.",
    source: "CoStar listing (sqftMin 1744); Matterport (area_indoor_sqft 1648, area_with_walls_sqft 1818, garage room 367.4)",
  },
  {
    q: "What are the taxes and HOA fees?",
    a: "Taxes are $5,911 a year, as of 2024, which is about $490 a month. The HOA is Sunrise Pines HOA at $30 a month, shown as a $363 fee on the record.",
    source: "CoStar listing (property.taxes 5911, hoa.totalFeesPerMonth 30, hoa.fee 363) and feature list",
  },
  {
    q: "Are the appliances included? The listing said they were still being installed.",
    a: "The remarks say new appliances will be installed before move-in. The scan from November 9 already shows a refrigerator, gas range, dishwasher and microwave in the kitchen, but only hookups in the laundry closet, no washer or dryer. I'll confirm with the listing agent what conveys.",
    source: "CoStar listing remarks and feature list; visible in scan (model created 2026-11-09)",
  },
  {
    q: "How big is the primary bedroom, and does it have its own bathroom?",
    a: "The primary bedroom is about 200 square feet, roughly 14 by 16 feet, with a 9 foot ceiling. It has its own bath of about 80 square feet with a double vanity, corner soaking tub and separate glass shower, plus a walk-in closet off the bath.",
    source: "Matterport room polygons (Bedroom 201.8, Bathroom 80.1, Closet 33.1); visible in scan",
  },
  {
    q: "How big is the lot, and is there a pool?",
    a: "The lot is about a tenth of an acre, 4,600 square feet, with a fenced back yard per the record. The Vexcel parcel outline is roughly 40 by 110 feet, the house covers about half of it, and no pool is detected.",
    source: "CoStar listing (lotSizeAcres 0.1056, Back Yard Fenced); Vexcel parcel (footprint 2,247 sq ft, pool.detected false)",
  },
  {
    q: "What shape is the roof in?",
    a: "It is a shingle hip roof. Vexcel's analysis from August 2023 imagery scored it at the low end and flagged a tarp and discoloration; the newer aerial from early 2026 shows an even shingle roof with no tarp visible. Roof age and any replacement are not in the data, so I'd ask the listing agent and get it inspected.",
    source: "Vexcel parcel record (roof condition 1.0, tarp detected, discoloration 65.6%, ortho date 2023-08-02); Vexcel ortho us-tx-baytown-2026",
  },
  {
    q: "What have similar homes nearby gone for?",
    a: "The data has list prices, not sale prices. About 0.8 mile away, 10019 Meadow Mill Forest Lane, a 4 bed 2 bath of 1,394 square feet, was listed at $218,000 and closed October 30, 2026; 10035 Meadow Mill Forest Lane, 3 bed 2.5 bath and 1,798 square feet, was listed at $191,000 and closed November 2.",
    source: "CoStar residential-listings (two sold listings in Hidden Meadow, zip 77044; closePrice not populated)",
  },
  {
    q: "Why are the owners selling, and would they take less than asking?",
    a: "I don't have anything on the seller's reasons or what they would accept. The record does say seller concessions are offered, without an amount, so I'll confirm that with the listing agent.",
    source: "Not in the data (feature list only says 'Seller Concessions Offered')",
    decline: true,
  },
  {
    q: "Has it been inspected? Any foundation or flooding problems?",
    a: "There are no inspection results, foundation reports or flood information in any of the data I have. The record says slab foundation and that is all, so I'd get an inspection and check the flood zone rather than take my word for it.",
    source: "Not in the data (CoStar feature list: Slab Foundation; no inspection, flood or condition records)",
    decline: true,
  },
  {
    q: "What did it sell for last time, and how good are the schools?",
    a: "There is no prior sale price or sale history in the record. The listing names Sheldon Lake Elementary, C.E. King Middle and C.E. King High, but gives no ratings or distances, so I'd verify zoning and ratings with the district.",
    source: "Not in the data (no sale history; schools are names only in the CoStar feature list)",
    decline: true,
  },
];
