function getActiveChannelList()
{
  const token = PropertiesService.getScriptProperties().getProperty("SLACK_TOKEN");
  const method= 'POST';

  const payload = {
    token: token
  };

  const params = {
    method,
    payload
  };

  let response = UrlFetchApp.fetch('https://slack.com/api/channels.list', params);
  //Logger.log(response.getContentText());
  let res = JSON.parse(response.getContentText());
  if (!res.ok) {
    Logger.log("channels.list failed.");
    return;
  }
  const channels = res.channels;

  response = UrlFetchApp.fetch('https://slack.com/api/users.list', params);
  //Logger.log(response.getContentText());
  res = JSON.parse(response.getContentText());
  if (!res.ok) {
    Logger.log("users.list failed.");
    return;
  }
  const members = res.members;

  var lastweek_ts = Math.floor((new Date()).getTime() / 1000) - 7*24*60*60;
  var list = [];
  channels.forEach(function(channel) {
    //if (channel.num_members >= 30 || channel.num_members < 3 || channel.is_archived) {
    if (channel.num_members < 3 || channel.is_archived) {
      return;
    }
    if (['xxx'].includes(channel.name)) {
      // ignoreしたいchを指定
      return;
    }
    Utilities.sleep(1000); // APIのrate limitを回避する
    var response = UrlFetchApp.fetch('https://slack.com/api/channels.history', {method: 'POST', payload: {token: token, channel: channel.id}});
    var res = JSON.parse(response.getContentText());
    if (res.ok) {
      if (res.has_more) { // 100メッセージ以上ある
        var count = 0;
        var users = {};
        var emoMessages = [];
        for (var i = 0; i < res.messages.length; i++) {
          var message = res.messages[i];
          if (lastweek_ts > message.ts) {
            break;
          }
          if (message.subtype != "bot_message") {
            if (message.subtype) {
              Logger.log("message.subtype: " + message.subtype);
            }
            if (message.user) {
              if (!users[message.user]) {
                users[message.user] = 0;
              }
              users[message.user] ++;
              if (message.reactions) {
                var reactionCount = message.reactions
                  .map(function(reaction) {
                    return reaction.count;
                  })
                  .reduce(function(a, b) {
                    return a+b;
                  });
                Logger.log("reactionCount: " + reactionCount);
                if (reactionCount >= 3) {
                  Logger.log(message.text);
                  var mes = message.text.replace(/(<@[A-z0-9_-]+> )/g, '').replace(/\n/g, '');
                  emoMessages.push('「' + (mes.length > 100 ? mes.slice(0, 100) + '...' : mes) + '」');
                }
              }
            }
            count ++;
          }
        }
        if (count >= 10) {
          list.push('#' + channel.name + ': ' + channel.topic.value);
          var userlist = Object.keys(users).sort(function(a, b) {return users[b] - users[a];}).map(function(user) {
            for (var j = 0; j < members.length; j++) {
              if (members[j].id == user) return members[j].name;
            }
            return user;
          });
          if (userlist.length > 5) {
            userlist = userlist.slice(0, 5);
            userlist.push('...');
          }
          list.push('主な発言者: ' + userlist.join(', '));
          emoMessages.forEach(function(message) {
            //list.push(message);
          });
        }
      }
    } else {
      Logger.log("channels.history failed.");
    }
  });
  if (list.length > 0) {
    postSlack('先週30メッセージ以上会話があったチャンネルのリストです。\n先週どこでホットな会話が行われたかを知る参考にしてください。\n\n' + list.join('\n'), 'gas_test', 'kuma');
  }
}

function getInactiveChannelList()
{
  const token = PropertiesService.getScriptProperties().getProperty("SLACK_TOKEN");

  var response = UrlFetchApp.fetch('https://slack.com/api/channels.list', {method: 'POST', payload: {token}});
  //Logger.log(response.getContentText());
  var res = JSON.parse(response.getContentText());
  if (!res.ok) {
    Logger.log("channels.list failed.");
    return;
  }
  const channels = res.channels;

  var threemonth_ts = Math.floor((new Date()).getTime() / 1000) - 90*24*60*60;
  var list = [];
  channels.forEach(function(channel) {
    if (channel.is_archived) {
      return;
    }
    if (['xxx'].includes(channel.name)) {
      // ignoreしたいchを指定
      return;
    }
    Utilities.sleep(1000); // APIのrate limitを回避する
    var response = UrlFetchApp.fetch('https://slack.com/api/channels.history', {method: 'POST', payload: {token: token, channel: channel.id}});
    var res = JSON.parse(response.getContentText());
    if (res.ok) {
      if (res.messages[0].ts < threemonth_ts) {
        list.push(channel.name);
      }
    } else {
      Logger.log("channels.history failed.");
    }
  });
  if (list.length > 0) {
    postSlack('直近３ヶ月メッセージがなかったチャンネルのリストです。\n\n' + list.join('\n'), 'gas_test', 'kuma');
  }
}

// 直近1ヶ月発言のないメンバーをスレッドからleaveさせる
function kickChannelInactiveMembers(channelName)
{
  const token = PropertiesService.getScriptProperties().getProperty("SLACK_TOKEN");

  // channel idを探す
  // https://api.slack.com/methods/conversations.list
  var response = UrlFetchApp.fetch('https://slack.com/api/conversations.list', {method: 'POST', payload: {token, limit: 1000, exclude_archived: true}});
  //Logger.log(response.getContentText());
  var res = JSON.parse(response.getContentText());
  if (!res.ok) {
    Logger.log("conversations.list failed.");
    return;
  }
  let channelId = null;

  Logger.log(`channels length: ${res.channels.length}`);
  res.channels.forEach(channel => {
    if (channel.name == channelName) {
      channelId = channel.id
    }
  });

  if (!channelId) {
    Logger.log('channel not found.');
    return;
  }
  Logger.log(`channelId: ${channelId}`);

  const lastmonth_ts = Math.floor((new Date()).getTime() / 1000) - 30*24*60*60;
  Logger.log(`lastmonth_ts: ${lastmonth_ts}`);

  const talkUsers = {};

  const _getUsersFromRes = (_res) => {
    Logger.log(`message length: ${_res.messages.length}`);
    res.messages.forEach(message => {
      talkUsers[message.user] = true;
      // スレッド内も調べる
      Utilities.sleep(1000); // APIのrate limitを回避する
      const response2 = UrlFetchApp.fetch('https://slack.com/api/conversations.replies', {method: 'POST', payload: {token, channel: channelId, oldest: String(lastmonth_ts), ts: message.ts}});
      const res2 = JSON.parse(response2.getContentText());
      if (res2.ok) {
        Logger.log(`message length: ${res2.messages.length}`);
        res2.messages.forEach(message => {
          //Logger.log(message.text);
          if (message.user) talkUsers[message.user] = true;
        });
      } else {
        Logger.log(`conversations.replies failed. ${JSON.stringify(res2)}`);
        return;
      }
    });
  };

  // https://api.slack.com/methods/conversations.replies
  Utilities.sleep(1000); // APIのrate limitを回避する
  response = UrlFetchApp.fetch('https://slack.com/api/conversations.history', {method: 'POST', payload: {token, channel: channelId, oldest: String(lastmonth_ts)}});
  res = JSON.parse(response.getContentText());
  if (res.ok) {
    _getUsersFromRes(res);
    while (res.has_more) {
      Utilities.sleep(1000); // APIのrate limitを回避する
      response = UrlFetchApp.fetch('https://slack.com/api/conversations.history', {method: 'POST', payload: {token, channel: channelId, oldest: String(lastmonth_ts), cursor: res.response_metadata.next_cursor}});
      res = JSON.parse(response.getContentText());
      if (res.ok) {
        _getUsersFromRes(res);
      } else {
        Logger.log(`conversations.history failed. ${JSON.stringify(res)}`);
        return;
      }
    }
  } else {
    Logger.log(`conversations.history failed. ${JSON.stringify(res)}`);
    return;
  }

  Logger.log(`talkUsers: ${JSON.stringify(talkUsers)}`);

  // chのメンバー取得
  Utilities.sleep(1000); // APIのrate limitを回避する
  // https://api.slack.com/methods/conversations.members
  response = UrlFetchApp.fetch('https://slack.com/api/conversations.members', {method: 'POST', payload: {token, channel: channelId}});
  res = JSON.parse(response.getContentText());
  if (!res.ok) {
    Logger.log(`conversations.members failed. ${JSON.stringify(res)}`);
    return;
  }
  res.members.forEach(member => {
    if (!talkUsers[member]) {
      // 発言なし
      /* どのユーザーがkickされるかを見る用
      // https://api.slack.com/methods/users.info
      Utilities.sleep(100); // APIのrate limitを回避する
      response = UrlFetchApp.fetch('https://slack.com/api/users.info', {method: 'POST', payload: {token, user: member}});
      res = JSON.parse(response.getContentText());
      if (res.ok) {
        Logger.log(res.user.name);
      } else {
        Logger.log(`users.info failed. ${JSON.stringify(res)}`);
      }
      */
      Utilities.sleep(1000); // APIのrate limitを回避する
      // https://slack.com/api/conversations.kick
      response = UrlFetchApp.fetch('https://slack.com/api/conversations.kick', {method: 'POST', payload: {token, channel: channelId, user: member}});
      res = JSON.parse(response.getContentText());
      if (!res.ok) {
        Logger.log(`conversations.kick failed. ${JSON.stringify(res)}`);
      }
    }
  });
}

function kickInactiveMembers()
{
  // slackのchannel名を指定
  kickChannelInactiveMembers("gas_test");
}
