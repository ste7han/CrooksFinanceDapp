-- Auto-generated from src/data/heists.json
BEGIN;
INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES ('pickpocket', 'Pickpocket', 'Member', 1, 5, 1, 1, 0.005, 0.01, 2, 5, 'Easy')
       ON CONFLICT (key) DO UPDATE SET
         title='Pickpocket',
         min_role='Member',
         stamina_cost=1,
         recommended_strength=5,
         token_drops_min=1,
         token_drops_max=1,
         amount_usd_min=0.005,
         amount_usd_max=0.01,
         points_min=2,
         points_max=5,
         difficulty='Easy';
INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES ('shoplift', 'Shoplift', 'Hustler', 2, 50, 1, 1, 0.01, 0.02, 5, 10, 'Easy')
       ON CONFLICT (key) DO UPDATE SET
         title='Shoplift',
         min_role='Hustler',
         stamina_cost=2,
         recommended_strength=50,
         token_drops_min=1,
         token_drops_max=1,
         amount_usd_min=0.01,
         amount_usd_max=0.02,
         points_min=5,
         points_max=10,
         difficulty='Easy';
INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES ('robbery', 'Robbery', 'Street Soldier', 3, 100, 1, 1, 0.02, 0.05, 10, 15, 'Medium')
       ON CONFLICT (key) DO UPDATE SET
         title='Robbery',
         min_role='Street Soldier',
         stamina_cost=3,
         recommended_strength=100,
         token_drops_min=1,
         token_drops_max=1,
         amount_usd_min=0.02,
         amount_usd_max=0.05,
         points_min=10,
         points_max=15,
         difficulty='Medium';
INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES ('breakin', 'Break-In', 'Enforcer', 4, 250, 1, 1, 0.05, 0.1, 15, 25, 'Medium')
       ON CONFLICT (key) DO UPDATE SET
         title='Break-In',
         min_role='Enforcer',
         stamina_cost=4,
         recommended_strength=250,
         token_drops_min=1,
         token_drops_max=1,
         amount_usd_min=0.05,
         amount_usd_max=0.1,
         points_min=15,
         points_max=25,
         difficulty='Medium';
INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES ('armedrobbery', 'Armed Robbery', 'Officer', 5, 400, 1, 2, 0.1, 0.15, 20, 35, 'Hard')
       ON CONFLICT (key) DO UPDATE SET
         title='Armed Robbery',
         min_role='Officer',
         stamina_cost=5,
         recommended_strength=400,
         token_drops_min=1,
         token_drops_max=2,
         amount_usd_min=0.1,
         amount_usd_max=0.15,
         points_min=20,
         points_max=35,
         difficulty='Hard';
INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES ('bankjob', 'Bank Job', 'Captain', 6, 600, 1, 2, 0.15, 0.2, 30, 50, 'Very Hard')
       ON CONFLICT (key) DO UPDATE SET
         title='Bank Job',
         min_role='Captain',
         stamina_cost=6,
         recommended_strength=600,
         token_drops_min=1,
         token_drops_max=2,
         amount_usd_min=0.15,
         amount_usd_max=0.2,
         points_min=30,
         points_max=50,
         difficulty='Very Hard';
INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES ('armoredtruck', 'Armored Truck', 'General', 7, 750, 2, 2, 0.2, 0.3, 40, 60, 'Brutal')
       ON CONFLICT (key) DO UPDATE SET
         title='Armored Truck',
         min_role='General',
         stamina_cost=7,
         recommended_strength=750,
         token_drops_min=2,
         token_drops_max=2,
         amount_usd_min=0.2,
         amount_usd_max=0.3,
         points_min=40,
         points_max=60,
         difficulty='Brutal';
INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES ('drugshipment', 'Drug Shipment', 'Gang Leader', 8, 1000, 2, 3, 0.3, 0.5, 50, 75, 'Extreme')
       ON CONFLICT (key) DO UPDATE SET
         title='Drug Shipment',
         min_role='Gang Leader',
         stamina_cost=8,
         recommended_strength=1000,
         token_drops_min=2,
         token_drops_max=3,
         amount_usd_min=0.3,
         amount_usd_max=0.5,
         points_min=50,
         points_max=75,
         difficulty='Extreme';
INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES ('syndicate', 'Syndicate Treasury', 'Boss', 9, 3000, 2, 3, 0.5, 0.75, 60, 80, 'Insane')
       ON CONFLICT (key) DO UPDATE SET
         title='Syndicate Treasury',
         min_role='Boss',
         stamina_cost=9,
         recommended_strength=3000,
         token_drops_min=2,
         token_drops_max=3,
         amount_usd_min=0.5,
         amount_usd_max=0.75,
         points_min=60,
         points_max=80,
         difficulty='Insane';
INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES ('empirejob', 'The Empire Job', 'Immortal', 10, 5000, 3, 4, 0.75, 1, 75, 100, 'Mythic')
       ON CONFLICT (key) DO UPDATE SET
         title='The Empire Job',
         min_role='Immortal',
         stamina_cost=10,
         recommended_strength=5000,
         token_drops_min=3,
         token_drops_max=4,
         amount_usd_min=0.75,
         amount_usd_max=1,
         points_min=75,
         points_max=100,
         difficulty='Mythic';
COMMIT;