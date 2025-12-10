import requests

app_id = "868266555635295"
app_secret = "493bd209d5bde0bdc6e5dda48072cf67"
short_lived_token = "EAAMVrwZBedl8BQBtHZB2LkMgVeApYZBPu0CXZA9N5XKlX7NDNPxyZCUTszZByCjFsEF0ZB0LzuwrOcvMeZCNBHBEHidJTLUY5rciVBbf79oJfcmWz4ZBXc0JCDekw9tkTa6HGV0eMI5NYTbJnT1wLgOWfu3ZAZAFHvCqBhYcZBGaxE6eO9Gc2kdR9AtJVETsj8rvl4EKHw3SBztpql48wYwxGKjMF0DJZAckgj83g09JJG8oZD"
page_id = "220015244526738"

# Step 1: Exchange short-lived token for long-lived user token
url = "https://graph.facebook.com/v21.0/oauth/access_token"

params = {
    "grant_type": "fb_exchange_token",
    "client_id": app_id,
    "client_secret": app_secret,
    "fb_exchange_token": short_lived_token
}

res = requests.get(url, params=params)
long_lived_user_token = res.json().get("access_token")
print("Long-lived user token:", long_lived_user_token)

# Step 2: Get long-lived page token
url = f"https://graph.facebook.com/v19.0/{page_id}"
params = {
    "fields": "access_token",
    "access_token": long_lived_user_token
}

res = requests.get(url, params=params)
print("Long-lived page token:", res.json())
