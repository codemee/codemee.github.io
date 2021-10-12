let client;

let options = {
  username: 'meebox', // AIO 使用者名稱
  password: 'aio_aFyj218T7BBUvc6WEhPiSjjbaevf' // AIO 金鑰
}
client = mqtt.connect(
  // AIO mqtt websocket 走 443 埠
  "wss://io.adafruit.com:443", 
  options // 連接時指定選項登入 AIO
);
console.log('connnecting....');
client.on('connect', ()=>{
  console.log('connected.');
  client.subscribe("meebox/feeds/rain") // 我建立的 feed
  client.on("message", function (topic, payload) {
    console.log(payload);
    console.log([topic, payload].join(": "));
    console.log(payload - 10);
    // client.end()
  })

  // client.publish("meebox/feeds/rain", "hello");    

});
