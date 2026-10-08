"""Curated discovery universe for the Swing Ideas board (Top Buys tab).

Liquid, optionable names grouped by theme so you can spot swing-contract setups
outside your own watchlists. Edit freely — tickers that yfinance can't resolve
just show up unscored.
"""

SECTORS: dict[str, list[tuple[str, str]]] = {
    "Oil & Gas": [
        ("XOM", "Exxon Mobil"), ("CVX", "Chevron"), ("COP", "ConocoPhillips"),
        ("OXY", "Occidental"), ("EOG", "EOG Resources"), ("DVN", "Devon Energy"),
        ("FANG", "Diamondback"), ("SLB", "SLB"), ("HAL", "Halliburton"),
        ("MPC", "Marathon Petroleum"), ("PSX", "Phillips 66"), ("VLO", "Valero"),
        ("KMI", "Kinder Morgan"), ("WMB", "Williams"), ("LNG", "Cheniere Energy"),
    ],
    "Nuclear & Uranium": [
        ("CCJ", "Cameco"), ("CEG", "Constellation"), ("VST", "Vistra"),
        ("OKLO", "Oklo"), ("SMR", "NuScale"), ("LEU", "Centrus"),
        ("NNE", "Nano Nuclear"), ("BWXT", "BWX Technologies"), ("UEC", "Uranium Energy"),
        ("UUUU", "Energy Fuels"),
    ],
    "Power & Grid (AI)": [
        ("GEV", "GE Vernova"), ("ETN", "Eaton"), ("VRT", "Vertiv"),
        ("PWR", "Quanta Services"), ("NRG", "NRG Energy"), ("TLN", "Talen Energy"),
        ("NEE", "NextEra"),
    ],
    "Solar & Clean": [
        ("FSLR", "First Solar"), ("ENPH", "Enphase"), ("RUN", "Sunrun"),
        ("BE", "Bloom Energy"), ("PLUG", "Plug Power"), ("SEDG", "SolarEdge"),
    ],
    "Space": [
        ("RDW", "Redwire"), ("RKLB", "Rocket Lab"), ("ASTS", "AST SpaceMobile"),
        ("LUNR", "Intuitive Machines"), ("PL", "Planet Labs"), ("BKSY", "BlackSky"),
        ("FLY", "Firefly Aerospace"), ("KRMN", "Karman"), ("IRDM", "Iridium"),
        ("VSAT", "Viasat"),
    ],
    "Defense": [
        ("LMT", "Lockheed Martin"), ("NOC", "Northrop Grumman"), ("RTX", "RTX"),
        ("GD", "General Dynamics"), ("LHX", "L3Harris"), ("HII", "Huntington Ingalls"),
        ("KTOS", "Kratos"), ("AVAV", "AeroVironment"),
    ],
    "Drones & eVTOL": [
        ("JOBY", "Joby Aviation"), ("ACHR", "Archer Aviation"), ("RCAT", "Red Cat"),
        ("UMAC", "Unusual Machines"),
    ],
    "AI & Semis": [
        ("NVDA", "Nvidia"), ("AMD", "AMD"), ("AVGO", "Broadcom"), ("TSM", "TSMC"),
        ("MU", "Micron"), ("ARM", "Arm"), ("MRVL", "Marvell"), ("SMCI", "Super Micro"),
        ("QCOM", "Qualcomm"), ("INTC", "Intel"),
    ],
    "AI Software & Cyber": [
        ("PLTR", "Palantir"), ("CRWD", "CrowdStrike"), ("NET", "Cloudflare"),
        ("SNOW", "Snowflake"), ("ORCL", "Oracle"), ("SOUN", "SoundHound"),
        ("TEM", "Tempus AI"), ("AI", "C3.ai"),
    ],
    "Quantum": [
        ("IONQ", "IonQ"), ("RGTI", "Rigetti"), ("QBTS", "D-Wave"), ("QUBT", "Quantum Computing"),
    ],
    "Fintech": [
        ("SOFI", "SoFi"), ("HOOD", "Robinhood"), ("AFRM", "Affirm"), ("UPST", "Upstart"),
        ("PYPL", "PayPal"), ("XYZ", "Block"), ("NU", "Nu Holdings"),
    ],
    "Crypto Stocks & Miners": [
        ("COIN", "Coinbase"), ("MSTR", "Strategy"), ("CRCL", "Circle"),
        ("MARA", "MARA Holdings"), ("RIOT", "Riot Platforms"), ("CLSK", "CleanSpark"),
        ("IREN", "IREN"), ("CIFR", "Cipher Mining"), ("HUT", "Hut 8"),
    ],
    "EV & Batteries": [
        ("TSLA", "Tesla"), ("RIVN", "Rivian"), ("LCID", "Lucid"), ("QS", "QuantumScape"),
        ("ALB", "Albemarle"), ("NIO", "NIO"),
    ],
    "Biotech & Health": [
        ("LLY", "Eli Lilly"), ("NVO", "Novo Nordisk"), ("HIMS", "Hims & Hers"),
        ("VKTX", "Viking Therapeutics"), ("MRNA", "Moderna"), ("CRSP", "CRISPR"),
    ],
    "Metals & Mining": [
        ("FCX", "Freeport-McMoRan"), ("NEM", "Newmont"), ("MP", "MP Materials"),
        ("CLF", "Cleveland-Cliffs"), ("AA", "Alcoa"),
    ],
}


def all_tickers() -> list[str]:
    return list(dict.fromkeys(t for names in SECTORS.values() for t, _ in names))
