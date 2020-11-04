import ESP8266WebServer
import network
import machine
from umqtt.robust import MQTTClient

GPIO_NUM = 2 # Builtin led (D4)

# Wi-Fi configuration
STA_SSID = "FLAG-SCHOOL"
STA_PSK = "12345678"

# Disable AP interface
ap_if = network.WLAN(network.AP_IF)
ap_if.active(False)
  
# Connect to Wi-Fi if not connected
sta_if = network.WLAN(network.STA_IF)
sta_if.active(True)
sta_if.connect(STA_SSID, STA_PSK)
# Wait for connecting to Wi-Fi
while not sta_if.isconnected(): 
    pass

# Show IP address
print("Server started @", sta_if.ifconfig()[0])

# Get pin object for controlling builtin LED
pin = machine.Pin(GPIO_NUM, machine.Pin.OUT)
pin.on() # Turn LED off (it use sinking input)

# Start the server @ port 8899
ESP8266WebServer.begin(8899)

# Register handler for each path
# ESP8266WebServer.onPath("/cmd", handleCmd)

# Setting the path to documents
ESP8266WebServer.setDocPath("/www")

client = MQTTClient(
    client_id="raindrop", 
    server="io.adafruit.com", 
    user="mee_box", 
    password="aio_SWCI33xmj9X3EiiWlX00Btwj0iTj",
    ssl=False)

timer = machine.Timer(1)
def time_up(data):
    pin.value(1)
    
def get_cmd(topic, msg):
    if msg == b"100":
        pin.value(0)
        timer.init(
            mode=machine.Timer.ONE_SHOT,
            period=2000,
            callback=time_up
        )
    print(msg)

client.connect()
client.set_callback(get_cmd)
client.subscribe(b"mee_box/feeds/face");

try:
    while True:
        # Let server process requests
        ESP8266WebServer.handleClient()
        client.check_msg()
        client.ping()
except:
    ESP8266WebServer.close()
