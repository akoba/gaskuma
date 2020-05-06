// slackへポスト
function postSlack(message, channel, username)
{
  const payload = {
    text : message,
    link_names: 1
  }
  if (channel) {
    payload.channel = channel;
  } else {
    payload.channel = '#gas_test';
  }  
  if (username) {
    payload.username = username;
  }

  // POSTオプション
  const options = {
    "method" : "POST",
    "payload" : JSON.stringify(payload)
  }

  // アクセス先
  const url = PropertiesService.getScriptProperties().getProperty("SLACK_WEBHOOK_URL");
  // POSTリクエスト
  const response = UrlFetchApp.fetch(url, options);
  // HTML結果を取得
  const content = response.getContentText("UTF-8");
}
