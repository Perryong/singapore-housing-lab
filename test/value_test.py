# Value tab: resale geocoding, features and model (tools/geocode_resale.py, tools/train_value.py).
from tools.geocode_resale import geo_key

assert geo_key('406', 'ANG MO KIO AVE 10') == geo_key('406 ', 'Ang Mo Kio Avenue 10'), geo_key('406', 'ANG MO KIO AVE 10')
print('ok')
