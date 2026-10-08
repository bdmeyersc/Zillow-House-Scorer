"""Writes synthetic Zillow-like listing pages to samples/ so run.js, mock_server.py and e2e.js work without real saved pages."""
import os, subprocess
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'samples')
os.makedirs(os.path.join(ROOT, 'html'), exist_ok=True)

FILLER = ' Lovely home on a quiet street with an open floor plan, updated kitchen, new roof and plenty of natural light throughout the living areas.'
LISTINGS = [
    ('116199395', '1296 Winyah St, Sumter, SC 29150', 310000, 3, 2, 1850,
     ['Patio & porch: Screened, Rear Porch, Patio', 'Fencing: Back Yard', 'Levels: One', 'Garage spaces: 2',
      'Water source: Public', 'Has HOA: No'],
     'Screened back porch and fenced backyard. Fee simple, no land lease.'),
    ('200000001', '45 Marsh Hen Dr, Little River, SC 29566', 349000, 3, 2, 1900,
     ['Patio & porch: Screened, Patio', 'Fencing: Full', 'Levels: One', 'Garage spaces: 2', 'Water source: Well',
      'Waterfront features: Dock, Boat Slip', 'Has HOA: Yes', 'HOA fee: $85 monthly', 'Amenities included: Clubhouse, Pool'],
     'Deep water community with a clubhouse.'),
    ('200000002', '812 Elm St, Conway, SC 29526', 299000, 3, 2, 1750,
     ['Patio & porch: Deck', 'Fencing: None', 'Stories: 1', 'Garage spaces: 2', 'Water source: Public, Private Well',
      'Pool features: In Ground', 'Exterior features: Irrigation Sprinkler'],
     'Backyard oasis with a heated in-ground pool and a private dock on the creek. No HOA.'),
    ('200000003', '9 Pine Ln, Loris, SC 29569', 275000, 4, 2, 1700,
     ['Patio & porch: Front Porch', 'Garage spaces: 2', 'Levels: One'],
     'Neighborhood pool and clubhouse just down the street. Non-slip tile in the baths. HOA dues are $40 a month.'),
    ('200000004', '77 Oak Rd, Longs, SC 29568', 320000, 3, 2, 1650,
     ['Patio & porch: Screened, Back', 'Fencing: Wood', 'Levels: One', 'Garage spaces: 2', 'Water source: Public',
      'Has HOA: Yes', 'HOA fee: $1,200 annually'],
     'Well maintained home with a boat slip at the marina included. Docking station for your phone in the kitchen.'),
    ('200000005', '3 Lake Dr, Manning, SC 29102', 289000, 3, 2, 1800,
     ['Patio & porch: Patio', 'Garage spaces: 2', 'Stories: 1', 'Has HOA: Yes'],
     'Close to Lake Marion. Carpool friendly street; pool table stays.'),
    ('200000006', '15 Gull Ct, Little River, SC 29566', 265000, 3, 2, 1700,
     ['Patio & porch: Screened, Rear Porch, Patio', 'Fencing: Full', 'Levels: One', 'Garage spaces: 2'],
     'Well kept home in a land lease community near the waterway, lot rent $425 a month.'),
    ('200000007', '22 Heron Way, Conway, SC 29526', 285000, 3, 2, 1720,
     ['Patio & porch: Screened, Rear Porch, Patio', 'Fencing: Full', 'Levels: One', 'Garage spaces: 2', 'Land lease: Yes', 'Land lease amount: $300'],
     'Move-in ready with a big backyard.'),
]

for zpid, addr, price, bd, ba, sq, facts, desc in LISTINGS:
    name = addr.split(',')[0].replace(' ', '-')
    path = f"/homedetails/{addr.replace(', ', '-').replace(' ', '-')}/{zpid}_zpid/"
    town = addr.split(',')[1].strip()
    lines = [f'${price:,}', str(bd), 'beds', str(ba), 'baths', f'{sq:,}', 'sqft', addr, "What's special", desc + FILLER * 2,
             'Facts & features', 'Interior', f'Bedrooms: {bd}', f'Bathrooms: {ba}', f'Full bathrooms: {ba}',
             f'Total interior livable area: {sq:,} sqft', *facts, f'Year built: {1985 + int(zpid) % 30}', 'Price per square foot: $170/sqft']
    html = f"<html><head><title>{addr} | MLS #1 | Zillow</title></head><body>" + ''.join(f'<div>{l}</div>' for l in lines) + '</body></html>'
    open(os.path.join(ROOT, 'html', name + '.html'), 'w').write(html)
    open(os.path.join(ROOT, name + ' _ Zillow.mhtml'), 'w').write(f'Snapshot-Content-Location: https://www.zillow.com{path}\n')

if not os.path.exists(os.path.join(ROOT, 'cert.pem')):
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=www.zillow.com',
                    '-keyout', os.path.join(ROOT, 'key.pem'), '-out', os.path.join(ROOT, 'cert.pem')], check=True, capture_output=True)
